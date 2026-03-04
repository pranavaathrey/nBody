# N Body Simulation

## Build Instructions

#### PARALLEL BUILD (OPENMP)
`g++ -std=c++17 -O3 -march=native -flto -DNDEBUG -Wall -Wextra -pedantic -fopenmp -Iinclude src/main.cpp src/velocityVerlet.cpp src/barnesHutTree.cpp -o nbody_omp.exe`

#### SERIAL BUILD
`g++ -std=c++17 -O3 -march=native -flto -DNDEBUG -Wall -Wextra -pedantic -Iinclude src/main.cpp src/velocityVerlet.cpp src/barnesHutTree.cpp -o nbody_serial.exe`
