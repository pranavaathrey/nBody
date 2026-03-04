# N Body Simulation

## Build Instructions

#### PARALLEL BUILD
`g++ -std=c++17 -O3 -march=native -flto=auto -DNDEBUG -Wall -Wextra -pedantic -fopenmp -Iinclude src/main.cpp src/velocityVerlet.cpp src/barnesHutTree.cpp src/webSocketServer.cpp -o nbody_ws.exe -lpthread -lws2_32 -lmswsock`
