#include <iostream>
#include <chrono>
#include <thread>
#include <vector>
#include <cstring>
#include <csignal>
#include <atomic>
#include <deque>
#include <future>
#include <iomanip>
#include <limits>
#include <mutex>
#include <optional>
#include <sstream>

#include "nBodySim.hpp"
#include "scenarios.hpp"
#include "generated/frame_sample_generated.h"
#include "webSocketServer.hpp"

// TODO: take outlier pruning logic out of main and fix orbit trail resetting in frontend

namespace {
    constexpr int OUTLIER_SCAN_INTERVAL = 75;
    constexpr bool DEFAULT_OUTLIER_PRUNING_ENABLED = true;
    constexpr bool DEFAULT_SIM_PAUSED = false;
    constexpr float DEFAULT_SIM_DT = 0.016667f;
    constexpr float OUTLIER_RADIUS_MULTIPLIER = 8.0f;
    constexpr float OUTLIER_ACCELERATION_RATIO = 1e-4f;
    constexpr float MIN_OUTLIER_ACCELERATION_SQ = 1e-8f;
    constexpr float MIN_CORE_RADIUS_SQ = 1.0f;
    constexpr auto PAUSED_POLL_INTERVAL = chrono::milliseconds(10);

    atomic<bool> g_running{true};
    void handleSignal(int) {
        g_running = false;
    }

    struct RuntimeControlState {
        bool paused = DEFAULT_SIM_PAUSED;
        float dt = DEFAULT_SIM_DT;
        bool pruningEnabled = DEFAULT_OUTLIER_PRUNING_ENABLED;
        float defaultDt = DEFAULT_SIM_DT;
        bool defaultPruningEnabled = DEFAULT_OUTLIER_PRUNING_ENABLED;
    };

    struct ControlCommand {
        optional<bool> paused;
        optional<float> dt;
        optional<bool> pruningEnabled;
        bool reset = false;
    };

    bool parseControlBool(const string& value, bool& out) {
        if (value == "1" || value == "true") {
            out = true;
            return true;
        }
        if (value == "0" || value == "false") {
            out = false;
            return true;
        }
        return false;
    }

    bool parsePositiveFloat(const string& value, float& out) {
        try {
            size_t processed = 0;
            const float parsed = stof(value, &processed);
            if (processed != value.size() || !isfinite(parsed) || parsed <= 0.0f) return false;
            out = parsed;
            return true;
        } catch (...) {
            return false;
        }
    }

    optional<ControlCommand> parseControlMessage(const string& message) {
        if (message == "control:reset") {
            ControlCommand command;
            command.reset = true;
            return command;
        }

        constexpr string_view SET_PREFIX = "control:set?";
        if (message.rfind(SET_PREFIX.data(), 0) != 0) return nullopt;

        ControlCommand command;
        bool hasRecognizedField = false;
        const string query = message.substr(SET_PREFIX.size());
        size_t start = 0;

        while (start <= query.size()) {
            const size_t end = query.find('&', start);
            const string pair =
                query.substr(start, end == string::npos ? string::npos : end - start);

            if (!pair.empty()) {
                const size_t equals = pair.find('=');
                const string key = pair.substr(0, equals);
                const string value = equals == string::npos ? string() : pair.substr(equals + 1);

                if (key == "paused") {
                    bool parsed = false;
                    if (equals == string::npos || !parseControlBool(value, parsed)) return nullopt;
                    command.paused = parsed;
                    hasRecognizedField = true;
                } else if (key == "dt") {
                    float parsed = 0.0f;
                    if (equals == string::npos || !parsePositiveFloat(value, parsed)) return nullopt;
                    command.dt = parsed;
                    hasRecognizedField = true;
                } else if (key == "pruning") {
                    bool parsed = false;
                    if (equals == string::npos || !parseControlBool(value, parsed)) return nullopt;
                    command.pruningEnabled = parsed;
                    hasRecognizedField = true;
                }
            }

            if (end == string::npos) break;
            start = end + 1;
        }

        if (!hasRecognizedField) return nullopt;
        return command;
    }

    bool applyCommand(RuntimeControlState& state, const ControlCommand& command) {
        bool changed = false;

        if (command.reset) {
            if (state.paused != DEFAULT_SIM_PAUSED) {
                state.paused = DEFAULT_SIM_PAUSED;
                changed = true;
            }
            if (state.dt != state.defaultDt) {
                state.dt = state.defaultDt;
                changed = true;
            }
            if (state.pruningEnabled != state.defaultPruningEnabled) {
                state.pruningEnabled = state.defaultPruningEnabled;
                changed = true;
            }
            return changed;
        }

        if (command.paused.has_value() && state.paused != *command.paused) {
            state.paused = *command.paused;
            changed = true;
        }

        if (command.dt.has_value() && state.dt != *command.dt) {
            state.dt = *command.dt;
            changed = true;
        }

        if (command.pruningEnabled.has_value() && state.pruningEnabled != *command.pruningEnabled) {
            state.pruningEnabled = *command.pruningEnabled;
            changed = true;
        }

        return changed;
    }

    string encodeControlStateMessage(const RuntimeControlState& state) {
        ostringstream stream;
        stream << setprecision(6)
               << "control:state?paused=" << (state.paused ? 1 : 0)
               << "&dt=" << state.dt
               << "&pruning=" << (state.pruningEnabled ? 1 : 0)
               << "&defaultDt=" << state.defaultDt
               << "&defaultPruning=" << (state.defaultPruningEnabled ? 1 : 0);
        return stream.str();
    }

    struct ControlDrainResult {
        RuntimeControlState state;
        bool stateChanged = false;
        bool resetRequested = false;
    };

    class SimulationControlBridge {
        public:
        explicit SimulationControlBridge(RuntimeControlState initialState)
            : state_(initialState) {}

        bool enqueueMessage(const string& message) {
            optional<ControlCommand> command = parseControlMessage(message);
            if (!command.has_value()) return false;

            lock_guard<mutex> lock(mutex_);
            pendingCommands_.push_back(move(*command));
            return true;
        }

        RuntimeControlState snapshot() const {
            lock_guard<mutex> lock(mutex_);
            return state_;
        }

        ControlDrainResult drainPending() {
            lock_guard<mutex> lock(mutex_);
            ControlDrainResult result;

            while (!pendingCommands_.empty()) {
                result.stateChanged =
                    applyCommand(state_, pendingCommands_.front()) || result.stateChanged;
                result.resetRequested = pendingCommands_.front().reset || result.resetRequested;
                pendingCommands_.pop_front();
            }

            result.state = state_;
            return result;
        }

        private:
        mutable mutex mutex_;
        RuntimeControlState state_;
        deque<ControlCommand> pendingCommands_;
    };

    struct OutlierSnapshot {
        vector<float> posX;
        vector<float> posY;
        vector<float> posZ;
        vector<float> accelSq;
    };

    struct OutlierScanResult {
        int sourceFrame = -1;
        float centerX = 0.0f;
        float centerY = 0.0f;
        float centerZ = 0.0f;
        float distanceThresholdSq = numeric_limits<float>::infinity();
        float accelerationThresholdSq = 0.0f;
        vector<size_t> candidates;
    };

    size_t quantileIndex(size_t count, float quantile) {
        if (count <= 1) return 0;

        const float scaled = quantile * static_cast<float>(count - 1);
        return static_cast<size_t>(scaled);
    }

    float nthValue(vector<float> values, size_t nth) {
        nth = min(nth, values.size() - 1);
        nth_element(values.begin(), values.begin() + static_cast<ptrdiff_t>(nth), values.end());
        return values[nth];
    }

    OutlierSnapshot captureOutlierSnapshot(const ParticleSystem& system) {
        OutlierSnapshot snapshot;
        const size_t n = system.size();
        snapshot.posX.reserve(n);
        snapshot.posY.reserve(n);
        snapshot.posZ.reserve(n);
        snapshot.accelSq.reserve(n);

        for (const BodyBlock& blk : system.blocks)
            for (size_t lane = 0; lane < blk.count; ++lane) {
                snapshot.posX.push_back(blk.posX[lane]);
                snapshot.posY.push_back(blk.posY[lane]);
                snapshot.posZ.push_back(blk.posZ[lane]);

                const float ax = blk.forceX[lane] * blk.invMass[lane];
                const float ay = blk.forceY[lane] * blk.invMass[lane];
                const float az = blk.forceZ[lane] * blk.invMass[lane];
                snapshot.accelSq.push_back(ax * ax + ay * ay + az * az);
            }

        return snapshot;
    }

    OutlierScanResult analyzeOutliers(OutlierSnapshot snapshot, int frame) {
        OutlierScanResult result;
        result.sourceFrame = frame;

        const size_t n = snapshot.posX.size();
        if (n < 64) return result;

        result.centerX = nthValue(snapshot.posX, quantileIndex(n, 0.5f));
        result.centerY = nthValue(snapshot.posY, quantileIndex(n, 0.5f));
        result.centerZ = nthValue(snapshot.posZ, quantileIndex(n, 0.5f));

        vector<float> distSq;
        distSq.reserve(n);
        for (size_t i = 0; i < n; ++i) {
            const float dx = snapshot.posX[i] - result.centerX;
            const float dy = snapshot.posY[i] - result.centerY;
            const float dz = snapshot.posZ[i] - result.centerZ;
            distSq.push_back(dx * dx + dy * dy + dz * dz);
        }

        const float coreRadiusSq = max(nthValue(distSq, quantileIndex(n, 0.9f)), MIN_CORE_RADIUS_SQ);
        const float typicalAccelerationSq = nthValue(snapshot.accelSq, quantileIndex(n, 0.5f));

        result.distanceThresholdSq =
            coreRadiusSq * OUTLIER_RADIUS_MULTIPLIER * OUTLIER_RADIUS_MULTIPLIER;
        result.accelerationThresholdSq =
            max(typicalAccelerationSq * OUTLIER_ACCELERATION_RATIO, MIN_OUTLIER_ACCELERATION_SQ);

        for (size_t i = 0; i < n; ++i)
            if (distSq[i] > result.distanceThresholdSq &&
                snapshot.accelSq[i] <= result.accelerationThresholdSq)
                result.candidates.push_back(i);

        return result;
    }

    bool stillMatchesOutlier(const ParticleSystem& system, size_t idx, const OutlierScanResult& scan) {
        const float dx = system.posXAt(idx) - scan.centerX;
        const float dy = system.posYAt(idx) - scan.centerY;
        const float dz = system.posZAt(idx) - scan.centerZ;
        const float distSq = dx * dx + dy * dy + dz * dz;

        const float ax = system.forceXAt(idx) * system.invMassAt(idx);
        const float ay = system.forceYAt(idx) * system.invMassAt(idx);
        const float az = system.forceZAt(idx) * system.invMassAt(idx);
        const float accelSq = ax * ax + ay * ay + az * az;

        return distSq > scan.distanceThresholdSq &&
               accelSq <= scan.accelerationThresholdSq;
    }

    class OutlierPruner {
        public:
        void schedule(const ParticleSystem& system, int frame) {
            if (pendingScan_.valid() || system.size() == 0) return;

            OutlierSnapshot snapshot = captureOutlierSnapshot(system);
            pendingGeneration_ = generation_;
            pendingScan_ = async(
                launch::async,
                [snapshot = move(snapshot), frame]() mutable {
                    return analyzeOutliers(move(snapshot), frame);
                });
        }

        void invalidatePending() {
            ++generation_;
        }

        void applyReady(ParticleSystem& system, bool pruningEnabled) {
            if (!pendingScan_.valid()) return;
            if (pendingScan_.wait_for(chrono::milliseconds(0)) != future_status::ready) return;

            OutlierScanResult scan = pendingScan_.get();
            const uint64_t scanGeneration = pendingGeneration_;
            pendingGeneration_ = 0;

            if (!pruningEnabled || scanGeneration != generation_) return;
            if (scan.candidates.empty() || system.size() == 0) return;

            vector<size_t> toRemove;
            toRemove.reserve(scan.candidates.size());

            for (size_t idx : scan.candidates)
                if (idx < system.size() && stillMatchesOutlier(system, idx, scan))
                    toRemove.push_back(idx);

            if (system.removeIndices(move(toRemove)) > 0)
                initializeForces(system);
        }

        private:
        future<OutlierScanResult> pendingScan_;
        uint64_t generation_ = 0;
        uint64_t pendingGeneration_ = 0;
    };

    inline uint32_t toLittleEndian(uint32_t v) {
        #if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
        return ((v & 0x000000FFu) << 24) | ((v & 0x0000FF00u) << 8) |
            ((v & 0x00FF0000u) >> 8) | ((v & 0xFF000000u) >> 24);
        #else
        // little-endian host
        return v;
        #endif
    }

    void broadcastFrame(const ParticleSystem& system,
                        int frame,
                        flatbuffers::FlatBufferBuilder& builder,
                        FrameBroadcaster& broadcaster) {
        builder.Clear();

        float* interleaved = nullptr;
        const auto bodies = builder.CreateUninitializedVector<float>(system.size() * 6, &interleaved);

        size_t writeIdx = 0;
        for (const BodyBlock& blk : system.blocks)
            for (size_t lane = 0; lane < blk.count; ++lane) {
                interleaved[writeIdx++] = blk.posX[lane];
                interleaved[writeIdx++] = blk.posY[lane];
                interleaved[writeIdx++] = blk.posZ[lane];
                interleaved[writeIdx++] = blk.velX[lane];
                interleaved[writeIdx++] = blk.velY[lane];
                interleaved[writeIdx++] = blk.velZ[lane];
            }

        const auto sample = nbody::CreateFrameSample(
            builder,
            static_cast<uint32_t>(frame),
            static_cast<uint32_t>(system.size()),
            bodies);

        // Build a non-size-prefixed FlatBuffer so we can add our own 4-byte length prefix.
        nbody::FinishFrameSampleBuffer(builder, sample);

        const uint32_t payloadSize = static_cast<uint32_t>(builder.GetSize());
        const uint32_t lenLE = toLittleEndian(payloadSize);

        auto packet = make_shared<vector<uint8_t>>(sizeof(lenLE) + payloadSize);
        memcpy(packet->data(), &lenLE, sizeof(lenLE));
        memcpy(packet->data() + sizeof(lenLE), builder.GetBufferPointer(), payloadSize);
        broadcaster.broadcast(packet);
    }

}

int main() {
    signal(SIGINT, handleSignal);
    signal(SIGTERM, handleSignal);

    // ------------------INITIALIZE SYSTEM------------------//
    
    const size_t NUM_PARTICLES = 10000; // # of particles in system
    const string AGAMA_SNAPSHOT_PATH = "scenarios/initial_conditions_agama.bin";
    const size_t MAX_FPS = 100; // frame cap for output/write loop (set 0 to disable)
    ParticleSystem system;
    
    RuntimeControlState runtimeControls;
    SimulationControlBridge controlBridge(runtimeControls);

    int currentFrame = 0;
    OutlierPruner outlierPruner;
    
    // Try AGAMA-generated initial conditions first; fallback to procedural disk.
    if (!loadAgamaSnapshot(system, AGAMA_SNAPSHOT_PATH)) {
        cout << "AGAMA snapshot not loaded from " << AGAMA_SNAPSHOT_PATH
             << "; falling back to accretionDisk." << "\n";
        system.allocate(NUM_PARTICLES);
        accretionDisk(system, NUM_PARTICLES);
    }
    // populate acceleration at t=0 for correct first Verlet step
    initializeForces(system);
    const ParticleSystem initialSystem = system;

    // start WebSocket broadcaster on ws://localhost:8080/frames
    boost::asio::io_context ioc;
    FrameBroadcaster broadcaster(
        ioc,
        8080,
        [&controlBridge](const string& message) {
            cout << "[control] received: " << message << "\n";
            if (!controlBridge.enqueueMessage(message))
                cout << "[control] ignored invalid message\n";
        },
        [&controlBridge]() {
            return encodeControlStateMessage(controlBridge.snapshot());
        });
    thread wsThread([&ioc]() { ioc.run(); });

    flatbuffers::FlatBufferBuilder frameBuilder(
                    128 + NUM_PARTICLES * 6 * sizeof(float));

    const auto targetFrameDuration =
        (MAX_FPS > 0)
            ? chrono::duration_cast<chrono::steady_clock::duration>(
                chrono::duration<double>(1.0 / static_cast<double>(MAX_FPS)))
            : chrono::steady_clock::duration::zero();

    // ---------------------PHYSICS LOOP---------------------//
    cout << "Starting physics loop benchmark for "
              << NUM_PARTICLES << " bodies...\n";

    chrono::duration<double> totalTime;
    auto startTime = chrono::high_resolution_clock::now();
    chrono::duration<double> activeRunTime{0};
    auto activeSegmentStart = chrono::steady_clock::now();
    bool activeSegmentOpen = true;

        // the core execution loop
        while (g_running) {
            const bool pruningWasEnabled = runtimeControls.pruningEnabled;
            const ControlDrainResult controlUpdate = controlBridge.drainPending();
            runtimeControls = controlUpdate.state;

            if (controlUpdate.resetRequested) {
                system = initialSystem;
                currentFrame = 0;
                outlierPruner = OutlierPruner{};
            }

            if (pruningWasEnabled && !runtimeControls.pruningEnabled)
                outlierPruner.invalidatePending();

            if (controlUpdate.stateChanged) {
                const string controlStateMessage = encodeControlStateMessage(runtimeControls);
                cout << "[control] state: " << controlStateMessage << "\n";
                broadcaster.broadcastText(controlStateMessage);
            }

            const auto loopNow = chrono::steady_clock::now();
            if (runtimeControls.paused) {
                if (activeSegmentOpen) {
                    activeRunTime += loopNow - activeSegmentStart;
                    activeSegmentOpen = false;
                }
                this_thread::sleep_for(PAUSED_POLL_INTERVAL);
                continue;
            }

            if (!activeSegmentOpen) {
                activeSegmentStart = loopNow;
                activeSegmentOpen = true;
            }

            auto frameStart = chrono::steady_clock::now();
            auto computeStart = chrono::high_resolution_clock::now();

                outlierPruner.applyReady(system, runtimeControls.pruningEnabled);

                // execute one step of the Velocity Verlet and Barnes-Hut algorithm
                physicsTick(system, runtimeControls.dt);

                if(runtimeControls.pruningEnabled
                && (currentFrame % OUTLIER_SCAN_INTERVAL == 0))
                    outlierPruner.schedule(system, currentFrame);

            auto computeEnd = chrono::high_resolution_clock::now();
            chrono::duration<double, milli> frameTime = computeEnd - computeStart;

            // stream simulation data for every frame as interleaved FlatBuffers
            broadcastFrame(system, currentFrame, frameBuilder, broadcaster);

            if (MAX_FPS > 0) {
                const auto targetFrameEnd = frameStart + targetFrameDuration;
                #if defined(_WIN32)
                    // Windows sleep granularity is often too coarse for 5ms pacing; 
                    while (chrono::steady_clock::now() < targetFrameEnd)
                        this_thread::yield();
                #else
                    this_thread::sleep_until(targetFrameEnd);
                #endif
            }
            
            // output performance metrics every 50 frames
            if (currentFrame % 50 == 0) 
                cout << "Frame: " << currentFrame
                     << " | Bodies: " << system.size()
                     << " | Compute Time: " << frameTime.count() << " ms\n";
            currentFrame++;
        }

    auto endTime = chrono::high_resolution_clock::now();
    totalTime = endTime - startTime;

    if (activeSegmentOpen) {
        activeRunTime += chrono::steady_clock::now() - activeSegmentStart;
    }

    // ---------------------OUTPUT RESULTS---------------------//    
    double averageFPS =
        activeRunTime.count() > 0.0
            ? static_cast<double>(currentFrame) / activeRunTime.count()
            : 0.0;
    
    cout << "Benchmark complete.\n";
    cout << "Total Time: " << totalTime.count() << " seconds.\n";
    cout << "Average FPS: " << averageFPS << "\n";

    broadcaster.stop();
    ioc.stop();
    if (wsThread.joinable()) wsThread.join();

    return 0;
}
