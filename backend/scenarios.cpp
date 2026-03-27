#include "scenarios.hpp"
#include <cstdint>
#include <fstream>

namespace {
    // Binary format:
    // [u32 magic='AGM1'][u32 count][count * (10 x f32)]
    // per body fields: x y z vx vy vz fx fy fz mass
    constexpr uint32_t AGAMA_SNAPSHOT_MAGIC = 0x314D4741u;

    struct AgamaBodyRecord {
        float x;
        float y;
        float z;
        float vx;
        float vy;
        float vz;
        float fx;
        float fy;
        float fz;
        float mass;
    };
}

void accretionDisk(ParticleSystem& system, size_t count) {
    // gravitational constant and system parameters
    const float G = G_CONST;
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

        // Match circular speed to the same softened force law used by the solver.
        const float r2 = r * r;
        const float softened = sqrt(r2 + SOFTENING_SQ);
        float v = sqrt((G * centralMass * r2) / (softened * softened * softened));

        // apply the velocity along the tangential vector (-y/r, x/r)
        system.setVelocity(i, -v * (y / r), v * (x / r), 0.0f);
        system.setForceZero(i);
    }
}

bool loadAgamaSnapshot(ParticleSystem& system, const string& filePath) {
    ifstream in(filePath, ios::binary);
    if(!in) return false;

    uint32_t magic = 0;
    uint32_t count = 0;
    in.read(reinterpret_cast<char*>(&magic), sizeof(magic));
    in.read(reinterpret_cast<char*>(&count), sizeof(count));
    if(!in || magic != AGAMA_SNAPSHOT_MAGIC || count == 0) return false;

    vector<AgamaBodyRecord> records(static_cast<size_t>(count));
    in.read(
        reinterpret_cast<char*>(records.data()),
        static_cast<streamsize>(records.size() * sizeof(AgamaBodyRecord))
    );
    if(!in) return false;

    system.allocate(static_cast<size_t>(count));
    for(size_t i = 0; i < records.size(); ++i) {
        const AgamaBodyRecord& r = records[i];
        if (!(r.mass > 0.0f)) return false;

        system.setPosition(i, r.x, r.y, r.z);
        system.setVelocity(i, r.vx, r.vy, r.vz);
        system.setForce(i, r.fx, r.fy, r.fz);
        system.setMass(i, r.mass);
    }
    return true;
}

