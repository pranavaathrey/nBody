#include "nBodySim.hpp"

namespace {
class SimulationKernel {
    private:
    BarnesHutTree octree;

    static bool isLeaf(const OctreeNode& node) {
        for (int i = 0; i < 8; ++i) 
            if (node.children[i] != -1) return false;
        return true;
    }

    static void accumulateForce(float dx, float dy, float dz, float distSq, float sourceMass,
                                float particleMass, float& fx, float& fy, float& fz) {
        const float invDist = 1.0f / sqrt(distSq + SOFTENING_SQ);
        const float invDist3 = invDist * invDist * invDist;
        const float scale = G_CONST * particleMass * sourceMass * invDist3;
        fx += scale * dx;
        fy += scale * dy;
        fz += scale * dz;
    }

    static void applyForceFromTree(int pIdx, ParticleSystem& system,
                                   const vector<OctreeNode>& nodes, vector<int>& stack) {
        stack.clear();
        stack.push_back(0);

        const float px = system.posX[pIdx];
        const float py = system.posY[pIdx];
        const float pz = system.posZ[pIdx];
        const float particleMass = system.mass[pIdx];

        float fx = 0.0f;
        float fy = 0.0f;
        float fz = 0.0f;

        while (!stack.empty()) {
            const int nodeIdx = stack.back();
            stack.pop_back();
            const OctreeNode& node = nodes[nodeIdx];

            if (node.totalMass <= 0.0f) continue;

            const float dx = node.centerMassX - px;
            const float dy = node.centerMassY - py;
            const float dz = node.centerMassZ - pz;
            const float distSq = dx * dx + dy * dy + dz * dz;

            if (isLeaf(node)) {
                if (node.particleIndex == -1 || node.particleIndex == pIdx) continue;
                accumulateForce(dx, dy, dz, distSq, node.totalMass, particleMass, fx, fy, fz);
                continue;
            }
            const float sizeX = node.maxX - node.minX;
            const float sizeY = node.maxY - node.minY;
            const float sizeZ = node.maxZ - node.minZ;
            const float size = max(sizeX, max(sizeY, sizeZ));
            const float dist = sqrt(distSq + SOFTENING_SQ);

            if ((size / dist) < THETA)
                accumulateForce(dx, dy, dz, distSq, node.totalMass, particleMass, fx, fy, fz);
            else 
                for (int i = 0; i < 8; ++i) {
                    const int childIdx = node.children[i];
                    if (childIdx != -1) 
                        stack.push_back(childIdx);
                }
        }
        system.forceX[pIdx] = fx;
        system.forceY[pIdx] = fy;
        system.forceZ[pIdx] = fz;
    }

    public:
    void initializeForces(ParticleSystem& system) {
        octree.build(system);
        calculateForces(system);
    }
    void calculateForces(ParticleSystem& system) {
        const vector<OctreeNode>& nodes = octree.getNodes();
        if (nodes.empty()) return;

        const size_t n = system.posX.size();
        #ifdef _OPENMP
        #pragma omp parallel
        {
            vector<int> stack;
            stack.reserve(128);
            #pragma omp for
            for (ptrdiff_t i = 0; i < static_cast<ptrdiff_t>(n); ++i) 
                applyForceFromTree(static_cast<int>(i), system, nodes, stack);
        }
        #else
        vector<int> stack;
        stack.reserve(128);
        for (ptrdiff_t i = 0; i < static_cast<ptrdiff_t>(n); ++i) 
            applyForceFromTree(static_cast<int>(i), system, nodes, stack);
        #endif
    }
    void clearForces(ParticleSystem& system) const {
        const size_t n = system.forceX.size();
        #ifdef _OPENMP
        #pragma omp parallel for
        #endif
        for (ptrdiff_t i = 0; i < static_cast<ptrdiff_t>(n); ++i) {
            system.forceX[i] = 0.0f;
            system.forceY[i] = 0.0f;
            system.forceZ[i] = 0.0f;
        }
    }

    void physicsTick(ParticleSystem& system, float dt) {
        const size_t n = system.posX.size();
        const float halfDt = 0.5f * dt;
        const float halfDtSq = halfDt * dt;

        // First half-step: position and velocity updates from current acceleration.
        #ifdef _OPENMP
        #pragma omp parallel for
        #endif
        for (size_t i = 0; i < n; ++i) {
            const float ax = system.forceX[i] * system.invMass[i];
            const float ay = system.forceY[i] * system.invMass[i];
            const float az = system.forceZ[i] * system.invMass[i];

            system.posX[i] += system.velX[i] * dt + ax * halfDtSq;
            system.posY[i] += system.velY[i] * dt + ay * halfDtSq;
            system.posZ[i] += system.velZ[i] * dt + az * halfDtSq;

            system.velX[i] += ax * halfDt;
            system.velY[i] += ay * halfDt;
            system.velZ[i] += az * halfDt;
        }
        octree.build(system);
        calculateForces(system);

        // Second half-step: finalize velocity with updated acceleration.
        #ifdef _OPENMP
        #pragma omp parallel for
        #endif
        for (size_t i = 0; i < n; ++i) {
            const float ax = system.forceX[i] * system.invMass[i];
            const float ay = system.forceY[i] * system.invMass[i];
            const float az = system.forceZ[i] * system.invMass[i];

            system.velX[i] += ax * halfDt;
            system.velY[i] += ay * halfDt;
            system.velZ[i] += az * halfDt;
        }
    }
};

SimulationKernel& kernel() {
    static SimulationKernel instance;
    return instance;
}
}

void clearForces(ParticleSystem& system) {
    kernel().clearForces(system);
}
void calculateForces(ParticleSystem& system) {
    kernel().calculateForces(system);
}
void initializeForces(ParticleSystem& system) {
    kernel().initializeForces(system);
}
void physicsTick(ParticleSystem& system, float dt) {
    kernel().physicsTick(system, dt);
}
