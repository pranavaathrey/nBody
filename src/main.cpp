#include <iostream>
#include <fstream>
#include <random>
#include <chrono>

#include "nBodySim.hpp"

void initializeGalacticDisk(ParticleSystem& system, size_t count) {
    // gravitational constant and system parameters
    const float G = 1.0f; 
    const float centralMass = 100000.0f;
    const float maxRadius = 500.0f;
    const float diskThickness = 5.0f;

    // use a deterministic seed for repeatable benchmarking
    std::mt19937 gen(42); 
    
    // distribution parameters
    std::uniform_real_distribution<float> distRadius(0.05f, 1.0f); // avoid division by zero
    std::uniform_real_distribution<float> distAngle(0.0f, 2.0f * 3.1415926535f);
    std::uniform_real_distribution<float> distZ(-diskThickness, diskThickness);
    std::uniform_real_distribution<float> distMass(1.0f, 10.0f);

    // initialize the central supermassive body
    system.posX[0] = 0.0f; system.posY[0] = 0.0f; system.posZ[0] = 0.0f;
    system.velX[0] = 0.0f; system.velY[0] = 0.0f; system.velZ[0] = 0.0f;
    system.forceX[0] = 0.0f; system.forceY[0] = 0.0f; system.forceZ[0] = 0.0f;
    system.mass[0] = centralMass;

    // distribute the remaining N-1 particles
    for (size_t i = 1; i < count; ++i) {
        // area-uniform radial distribution
        float r = maxRadius * std::sqrt(distRadius(gen));
        float theta = distAngle(gen);

        // assign cartesian coordinates
        float x = r * std::cos(theta);
        float y = r * std::sin(theta);
        float z = distZ(gen);

        system.posX[i] = x;
        system.posY[i] = y;
        system.posZ[i] = z;
        system.mass[i] = distMass(gen);

        // calculate the scalar orbital velocity
        float v = std::sqrt(G * centralMass / r);

        // apply the velocity along the tangential vector (-y/r, x/r)
        system.velX[i] = -v * (y / r);
        system.velY[i] = v * (x / r);
        system.velZ[i] = 0.0f; 
        
        // zero out initial forces
        system.forceX[i] = 0.0f;
        system.forceY[i] = 0.0f;
        system.forceZ[i] = 0.0f;
    }
}

int main() {
    // ------------------INITIALIZE SYSTEM------------------//
    // # of particles in system
    const size_t NUM_PARTICLES = 10000;
    ParticleSystem system;
    // fixed time step length
    const float dt = 0.016667f; // 60 ticks per simulated second
    // Benchmark config
    const int TARGET_FRAMES = 1000;
    int currentFrame = 0;
    
    // allocate contiguous memory
    system.allocate(NUM_PARTICLES);
    // seed initial positions, masses, and velocities
    initializeGalacticDisk(system, NUM_PARTICLES); 
    // populate acceleration at t=0 for correct first Verlet step
    initializeForces(system);

    // export sampled 2D positions for visualization
    ofstream out("visualize/frames.csv");
    out << "frame,id,x,y\n";

    // ---------------------PHYSICS LOOP---------------------//
    cout << "Starting physics loop benchmark for " 
         << NUM_PARTICLES << " bodies...\n";

    chrono::duration<double> totalTime;
    auto startTime = chrono::high_resolution_clock::now();

        // the core execution loop
        while (currentFrame < TARGET_FRAMES) {
            auto frameStart = chrono::high_resolution_clock::now();

                // execute one step of the Velocity Verlet and Barnes-Hut algorithm
                physicsTick(system, dt);

            auto frameEnd = chrono::high_resolution_clock::now();
            chrono::duration<double, milli> frameTime = frameEnd - frameStart;

            // write simulation data to csv every 5 frames
            if (currentFrame % 5 == 0) 
                for (size_t i = 0; i < NUM_PARTICLES; ++i) {
                    out << currentFrame << "," << i << ","
                        << system.posX[i] << "," << system.posY[i] << "\n";
                }
            
            // output performance metrics every 50 frames
            if (currentFrame % 50 == 0) 
                cout << "Frame: " << currentFrame 
                    << " | Compute Time: " << frameTime.count() << " ms\n";
            currentFrame++;
        }

    auto endTime = chrono::high_resolution_clock::now();
    totalTime = endTime - startTime;

    // ---------------------OUTPUT RESULTS---------------------//    
    double averageFPS = TARGET_FRAMES / totalTime.count();
    
    cout << "Benchmark complete.\n";
    cout << "Total Time: " << totalTime.count() << " seconds.\n";
    cout << "Average FPS: " << averageFPS << "\n";

    return 0;
}
