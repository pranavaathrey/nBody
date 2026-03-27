# N Body Simulation

## Build Instructions

#### PARALLEL BUILD
`g++ -std=c++17 -O3 -march=native -flto=auto -DNDEBUG -Wall -Wextra -pedantic -fopenmp -Iinclude backend/main.cpp backend/velocityVerlet.cpp backend/barnesHutTree.cpp backend/webSocketServer.cpp backend/scenarios.cpp -o nbody_ws.exe -lpthread -lws2_32 -lmswsock`
