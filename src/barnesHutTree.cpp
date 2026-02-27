#include "nBodySim.hpp"

int BarnesHutTree::allocateNode() {
    nodes.push_back(OctreeNode());
    return nodes.size() - 1;
}
int BarnesHutTree::getOctant(const OctreeNode& node, float x, float y, float z) const {
    float midX = (node.minX + node.maxX) * 0.5f;
    float midY = (node.minY + node.maxY) * 0.5f;
    float midZ = (node.minZ + node.maxZ) * 0.5f;
    
    int octant = 0;
    if (x >= midX) octant |= 1;
    if (y >= midY) octant |= 2;
    if (z >= midZ) octant |= 4;
    return octant;
}

void BarnesHutTree::insertParticle(int nodeIdx, int pIdx, 
                                   const ParticleSystem& system, int depth) {
    if (depth >= MAX_DEPTH) {
        // reached maximum depth; force the particle into this leaf 
        // to prevent stack overflow
        nodes[nodeIdx].particleIndex = pIdx;
        return;
    }
    // empty leaf
    if (nodes[nodeIdx].particleIndex == -1 && nodes[nodeIdx].children[0] == -1) {
        nodes[nodeIdx].particleIndex = pIdx;
        return;
    }    
    // occupied leaf, subdivide
    if (nodes[nodeIdx].particleIndex != -1) {
        int existingPIdx = nodes[nodeIdx].particleIndex;
        nodes[nodeIdx].particleIndex = -1; 
        
        float midX = (nodes[nodeIdx].minX + nodes[nodeIdx].maxX) * 0.5f;
        float midY = (nodes[nodeIdx].minY + nodes[nodeIdx].maxY) * 0.5f;
        float midZ = (nodes[nodeIdx].minZ + nodes[nodeIdx].maxZ) * 0.5f;
        
        for (int i = 0; i < 8; ++i) {
            int childIdx = allocateNode();
            nodes[nodeIdx].children[i] = childIdx;
            
            nodes[childIdx].minX = (i & 1) ? midX : nodes[nodeIdx].minX;
            nodes[childIdx].maxX = (i & 1) ? nodes[nodeIdx].maxX : midX;
            nodes[childIdx].minY = (i & 2) ? midY : nodes[nodeIdx].minY;
            nodes[childIdx].maxY = (i & 2) ? nodes[nodeIdx].maxY : midY;
            nodes[childIdx].minZ = (i & 4) ? midZ : nodes[nodeIdx].minZ;
            nodes[childIdx].maxZ = (i & 4) ? nodes[nodeIdx].maxZ : midZ;
        }        
        int octantExisting = getOctant(nodes[nodeIdx], system.posX[existingPIdx], system.posY[existingPIdx], system.posZ[existingPIdx]);
        insertParticle(nodes[nodeIdx].children[octantExisting], existingPIdx, system, depth + 1);
    }        
    // insert new particle
    int octantNew = getOctant(nodes[nodeIdx], system.posX[pIdx], system.posY[pIdx], system.posZ[pIdx]);
    insertParticle(nodes[nodeIdx].children[octantNew], pIdx, system, depth + 1);
}

void BarnesHutTree::computeMassDistribution(int nodeIdx, const ParticleSystem& system) {
    OctreeNode& node = nodes[nodeIdx];
    
    if (node.children[0] == -1) {
        if (node.particleIndex != -1) {
            node.totalMass = system.mass[node.particleIndex];
            node.centerMassX = system.posX[node.particleIndex];
            node.centerMassY = system.posY[node.particleIndex];
            node.centerMassZ = system.posZ[node.particleIndex];
        }
        return;
    }    
    node.totalMass = 0.0f;
    node.centerMassX = 0.0f;
    node.centerMassY = 0.0f;
    node.centerMassZ = 0.0f;
    
    for (int i = 0; i < 8; ++i) {
        int childIdx = node.children[i];
        computeMassDistribution(childIdx, system);
        
        float childMass = nodes[childIdx].totalMass;
        if (childMass > 0.0f) {
            node.totalMass += childMass;
            node.centerMassX += nodes[childIdx].centerMassX * childMass;
            node.centerMassY += nodes[childIdx].centerMassY * childMass;
            node.centerMassZ += nodes[childIdx].centerMassZ * childMass;
        }
    }    
    if (node.totalMass > 0.0f) {
        node.centerMassX /= node.totalMass;
        node.centerMassY /= node.totalMass;
        node.centerMassZ /= node.totalMass;
    }
}

const vector<OctreeNode>& BarnesHutTree::getNodes() const {
    return nodes;
}

void BarnesHutTree::build(const ParticleSystem& system) {
    size_t n = system.posX.size();
    if (n == 0) return;

    // reserve memory upfront to minimize allocations during insertion
    nodes.clear();
    nodes.reserve(n * 2); 

    float minX = numeric_limits<float>::max(), maxX = -numeric_limits<float>::max();
    float minY = numeric_limits<float>::max(), maxY = -numeric_limits<float>::max();
    float minZ = numeric_limits<float>::max(), maxZ = -numeric_limits<float>::max();

    for(size_t i = 0; i < n; ++i) {
        minX = min(minX, system.posX[i]); maxX = max(maxX, system.posX[i]);
        minY = min(minY, system.posY[i]); maxY = max(maxY, system.posY[i]);
        minZ = min(minZ, system.posZ[i]); maxZ = max(maxZ, system.posZ[i]);
    }    
    float epsilon = 1e-5f;
    minX -= epsilon; maxX += epsilon;
    minY -= epsilon; maxY += epsilon;
    minZ -= epsilon; maxZ += epsilon;

    int rootIdx = allocateNode();
    nodes[rootIdx].minX = minX; nodes[rootIdx].maxX = maxX;
    nodes[rootIdx].minY = minY; nodes[rootIdx].maxY = maxY;
    nodes[rootIdx].minZ = minZ; nodes[rootIdx].maxZ = maxZ;

    for(size_t i = 0; i < n; ++i) {
        insertParticle(rootIdx, i, system, 0);
    }
    computeMassDistribution(rootIdx, system);
}