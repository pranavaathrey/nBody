#include "nBodySim.hpp"

BarnesHutTree octree;

void clearForces(ParticleSystem& system) {
    fill(system.forceX.begin(), system.forceX.end(), 0.0f);
    fill(system.forceY.begin(), system.forceY.end(), 0.0f);
    fill(system.forceZ.begin(), system.forceZ.end(), 0.0f);
}

// helper: traverses the tree to compute force on a specific particle
void applyForceFromNode(int pIdx, int nodeIdx, ParticleSystem& system, const vector<OctreeNode>& nodes) {
    if (nodeIdx < 0) return;
    const OctreeNode& node = nodes[nodeIdx];
    
    // skip empty nodes
    if (node.children[0] == -1 && node.particleIndex == -1) return;
    
    float dx = node.centerMassX - system.posX[pIdx];
    float dy = node.centerMassY - system.posY[pIdx];
    float dz = node.centerMassZ - system.posZ[pIdx];
    float distSq = dx*dx + dy*dy + dz*dz;
    
    // if leaf node
    if (node.children[0] == -1) {
        if (node.particleIndex != pIdx) { // avoid self-interaction
            float dist = sqrt(distSq + SOFTENING_SQ);
            float force = (G_CONST * system.mass[pIdx] * node.totalMass)
                        / (distSq + SOFTENING_SQ);
            
            system.forceX[pIdx] += force * (dx / dist);
            system.forceY[pIdx] += force * (dy / dist);
            system.forceZ[pIdx] += force * (dz / dist);
        }
        return;
    }    
    // internal node – apply Barnes-Hut criterion
    float sizeX = node.maxX - node.minX;
    float sizeY = node.maxY - node.minY;
    float sizeZ = node.maxZ - node.minZ;
    float size = max(sizeX, max(sizeY, sizeZ));
    float dist = sqrt(distSq + SOFTENING_SQ);
    
    if ((size / dist) < THETA) {
        // node is far enough; treat as a point mass
        float force = (G_CONST * system.mass[pIdx] * node.totalMass) 
                    / (distSq + SOFTENING_SQ);
        
        system.forceX[pIdx] += force * (dx / dist);
        system.forceY[pIdx] += force * (dy / dist);
        system.forceZ[pIdx] += force * (dz / dist);
    } else {
        // node is too close; recurse into children
        for (int i = 0; i < 8; ++i) {
            const int childIdx = node.children[i];
            if (childIdx != -1) 
                applyForceFromNode(pIdx, childIdx, system, nodes);
        }
    }
}
void calculateForces(ParticleSystem& system) {
    const vector<OctreeNode>& nodes = octree.getNodes();
    if (nodes.empty()) return;

    size_t n = system.posX.size();
    #ifdef _OPENMP
    #pragma omp parallel for
    #endif
    for (ptrdiff_t i = 0; i < static_cast<ptrdiff_t>(n); ++i) 
        // root node is always at index 0
        applyForceFromNode(static_cast<int>(i), 0, system, nodes); 
}
void initializeForces(ParticleSystem& system) {
    clearForces(system);
    octree.build(system);
    calculateForces(system);
}

// Velocity Verlet implementation
void physicsTick(ParticleSystem& system, float dt) {
    size_t n = system.posX.size();

    // first half of Verlet: update positions and half-velocities
    for(size_t i = 0; i < n; ++i) {
        float ax = system.forceX[i] / system.mass[i];
        float ay = system.forceY[i] / system.mass[i];
        float az = system.forceZ[i] / system.mass[i];

        system.posX[i] += system.velX[i] * dt + 0.5f * ax * dt * dt;
        system.posY[i] += system.velY[i] * dt + 0.5f * ay * dt * dt;
        system.posZ[i] += system.velZ[i] * dt + 0.5f * az * dt * dt;

        system.velX[i] += 0.5f * ax * dt;
        system.velY[i] += 0.5f * ay * dt;
        system.velZ[i] += 0.5f * az * dt;
    }
    // clear forces and rebuild the octree
    clearForces(system);
    octree.build(system); 

    // calculate new forces using Barnes-Hut traversing
    calculateForces(system); 

    // second half of Verlet: finalize velocities
    for(size_t i = 0; i < n; ++i) {
        float new_ax = system.forceX[i] / system.mass[i];
        float new_ay = system.forceY[i] / system.mass[i];
        float new_az = system.forceZ[i] / system.mass[i];

        system.velX[i] += 0.5f * new_ax * dt;
        system.velY[i] += 0.5f * new_ay * dt;
        system.velZ[i] += 0.5f * new_az * dt;
    }
}
