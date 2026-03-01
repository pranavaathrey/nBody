#include <vector>
#include <cmath>
#include <limits>
#include <algorithm>
#include <cstddef>

using namespace std;

// simulation constants
const float G_CONST = 1.0f;       // gravitational constant
const float THETA = 0.5f;         // Barnes-Hut threshold
const float SOFTENING_SQ = 0.1f;  // softening factor squared to prevent infinite forces

// universe

struct ParticleSystem { // structure of arrays
    // positions
    vector<float> posX, posY, posZ;
    // velocities
    vector<float> velX, velY, velZ;
    // accumulated Forces
    vector<float> forceX, forceY, forceZ;
    // mass
    vector<float> mass;
    // cached reciprocal mass to avoid repeated divisions in the integrator
    vector<float> invMass;

    void allocate(size_t n) {
        posX.assign(n, 0.0f); posY.assign(n, 0.0f); posZ.assign(n, 0.0f);
        velX.assign(n, 0.0f); velY.assign(n, 0.0f); velZ.assign(n, 0.0f);
        forceX.assign(n, 0.0f); forceY.assign(n, 0.0f); forceZ.assign(n, 0.0f);
        mass.assign(n, 1.0f);
        invMass.assign(n, 1.0f);
    }
};
struct OctreeNode {
    float centerMassX, centerMassY, centerMassZ; 
    float totalMass;
    
    // bounding box for this node
    float minX, minY, minZ;          
    float maxX, maxY, maxZ;
    
    // -1 if this is an internal node, >= 0 if it holds a specific particle
    int particleIndex;               
    
    // indices to child nodes in the pre-allocated node vector (-1 if null)
    int children[8];                 

    OctreeNode() : totalMass(0.0f), particleIndex(-1) {
        for(int i = 0; i < 8; ++i) children[i] = -1;
    }
};

class BarnesHutTree {
    private:
    vector<OctreeNode> nodes;
    
    // safety mechanism to prevent infinite recursion for coincident particles
    static constexpr int MAX_DEPTH = 32; 

    // helper: allocates a new node and returns its index
    int allocateNode();
    // helper: determines which of the 8 octants a position belongs to
    int getOctant(const OctreeNode& node, float x, float y, float z) const;

    // helper: recursively inserts a particle into the tree
    void insertParticle(int nodeIdx, int pIdx, const ParticleSystem& system, int depth);

    // helper: computes mass and center of mass via post-order traversal
    void computeMassDistribution(int nodeIdx, const ParticleSystem& system);

    public:
    // expose the internal array for read-only 
    // access during the force calculation phase
    const vector<OctreeNode>& getNodes() const;

    void build(const ParticleSystem& system);
};

// physics

void physicsTick(ParticleSystem& system, float dt);
void initializeForces(ParticleSystem& system);

void clearForces(ParticleSystem& system);
void calculateForces(ParticleSystem& system); 
