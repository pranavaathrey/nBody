#include <iostream>
#include <fstream>
#include <random>
#include <chrono>
#include <thread>
#include <vector>
#include <cstring>
#include <csignal>
#include <atomic>
#include <limits>

#include "nBodySim.hpp"
#include "generated/frame_sample_generated.h"
#include "WebSocketServer.hpp"
#include <csignal>
#include <atomic>

namespace {

    atomic<bool> g_running{true};
    void handleSignal(int) {
        g_running = false;
    }

    inline uint32_t toLittleEndian(uint32_t v) {
        #if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
        return ((v & 0x000000FFu) << 24) | ((v & 0x0000FF00u) << 8) |
            ((v & 0x00FF0000u) >> 8) | ((v & 0xFF000000u) >> 24);
        #else
        // little-endian host
        return v;
        #endif
    }

    void writeFrameToOutputs(const ParticleSystem& system,
                            int frame,
                            flatbuffers::FlatBufferBuilder& builder,
                            ofstream* out,
                            FrameBroadcaster* broadcaster) {
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

        if (out && out->is_open()) {
            out->write(reinterpret_cast<const char*>(&lenLE), sizeof(lenLE));
            out->write(reinterpret_cast<const char*>(builder.GetBufferPointer()),
                    static_cast<streamsize>(payloadSize));
        }

        if (broadcaster) {
            auto packet = make_shared<vector<uint8_t>>(sizeof(lenLE) + payloadSize);
            memcpy(packet->data(), &lenLE, sizeof(lenLE));
            memcpy(packet->data() + sizeof(lenLE), builder.GetBufferPointer(), payloadSize);
            broadcaster->broadcast(packet);
        }
    }

}

void initializeGalacticDisk(ParticleSystem& system, size_t count) {
    // gravitational constant and system parameters
    const float G = 1.0f; 
    const float centralMass = 100000.0f;
    const float maxRadius = 500.0f;
    const float diskThickness = 5.0f;

    // use a deterministic seed for repeatable benchmarking
    mt19937 gen(42); 
    
    // distribution parameters
    uniform_real_distribution<float> distRadius(0.05f, 1.0f); // avoid div by zero
    uniform_real_distribution<float> distAngle(0.0f, 2.0f * 3.1415926535f);
    uniform_real_distribution<float> distZ(-diskThickness, diskThickness);
    uniform_real_distribution<float> distMass(1.0f, 10.0f);

    // initialize the central supermassive body
    system.setPosition(0, 0.0f, 0.0f, 0.0f);
    system.setVelocity(0, 0.0f, 0.0f, 0.0f);
    system.setForceZero(0);
    system.setMass(0, centralMass);

    // distribute the remaining N-1 particles
    for (size_t i = 1; i < count; ++i) {
        // area-uniform radial distribution
        float r = maxRadius * sqrt(distRadius(gen));
        float theta = distAngle(gen);

        // assign cartesian coordinates
        float x = r * cos(theta);
        float y = r * sin(theta);
        float z = distZ(gen);

        system.setPosition(i, x, y, z);
        system.setMass(i, distMass(gen));

        // calculate the scalar orbital velocity
        float v = sqrt(G * centralMass / r);

        // apply the velocity along the tangential vector (-y/r, x/r)
        system.setVelocity(i, -v * (y / r), v * (x / r), 0.0f);
        system.setForceZero(i);
    }
}

int main() {
    signal(SIGINT, handleSignal);
    signal(SIGTERM, handleSignal);

    // ------------------INITIALIZE SYSTEM------------------//
    
    const size_t NUM_PARTICLES = 100; // # of particles in system
    ParticleSystem system;
    
    const float dt = 0.016667f; // fixed time step length (60 ticks per sim second)
    
    int currentFrame = 0;
    
    // allocate contiguous memory
    system.allocate(NUM_PARTICLES);
    // seed initial positions, masses, and velocities
    initializeGalacticDisk(system, NUM_PARTICLES); 
    // populate acceleration at t=0 for correct first Verlet step
    initializeForces(system);

    // export sampled positions and velocities for visualization as size-prefixed FlatBuffers
    ofstream out("frontend/frames.fb", ios::binary);
    if (!out) {
        cerr << "Failed to open output file: frontend/frames.fb\n";
        return 1;
    }
    // start WebSocket broadcaster on ws://localhost:8080/frames
    boost::asio::io_context ioc;
    FrameBroadcaster broadcaster(ioc, 8080);
    thread wsThread([&ioc]() { ioc.run(); });

    flatbuffers::FlatBufferBuilder frameBuilder(
                    128 + NUM_PARTICLES * 6 * sizeof(float));

    // ---------------------PHYSICS LOOP---------------------//
    cout << "Starting physics loop benchmark for "
              << NUM_PARTICLES << " bodies...\n";

    chrono::duration<double> totalTime;
    auto startTime = chrono::high_resolution_clock::now();

        // the core execution loop
        while (g_running) {
            auto frameStart = chrono::high_resolution_clock::now();

                // execute one step of the Velocity Verlet and Barnes-Hut algorithm
                physicsTick(system, dt);

            auto frameEnd = chrono::high_resolution_clock::now();
            chrono::duration<double, milli> frameTime = frameEnd - frameStart;

            // write simulation data for every frame as interleaved FlatBuffers
            writeFrameToOutputs(system, currentFrame, frameBuilder, &out, &broadcaster);
            
            // output performance metrics every 50 frames
            if (currentFrame % 50 == 0) 
                cout << "Frame: " << currentFrame
                     << " | Compute Time: " << frameTime.count() << " ms\n";
            currentFrame++;
        }

    auto endTime = chrono::high_resolution_clock::now();
    totalTime = endTime - startTime;

    // ---------------------OUTPUT RESULTS---------------------//    
    double averageFPS = static_cast<double>(currentFrame) / totalTime.count();
    
    cout << "Benchmark complete.\n";
    cout << "Total Time: " << totalTime.count() << " seconds.\n";
    cout << "Average FPS: " << averageFPS << "\n";

    broadcaster.stop();
    ioc.stop();
    if (wsThread.joinable()) wsThread.join();

    return 0;
}
