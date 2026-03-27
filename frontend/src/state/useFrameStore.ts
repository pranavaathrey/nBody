import { create } from 'zustand';
import { ORBIT_TRAILS_ENABLED, WORLD_GRID_ENABLED } from '../lib/config';
import type { SimControlSnapshot } from '../lib/simControl';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type FramePayload = {
  frame: number;
  bodyCount: number;
  bodies: Float32Array;
  receivedAt: number;
  bytes: number;
};

export type FrameState = {
  frame: number;
  bodyCount: number;
  positions: Float32Array | null;
  velocities: Float32Array | null;
  fps: number;
  status: ConnectionStatus;
  totalBytes: number;
  lastFrameTime: number;
  showVelocityVectors: boolean;
  showAccelerationVectors: boolean;
  showOrbitTrails: boolean;
  showWorldGrid: boolean;
  invertLook: boolean;
  cameraBaseMoveSpeed: number;
  simPaused: boolean;
  simDt: number;
  simPruningEnabled: boolean;
  simDefaultDt: number;
  simDefaultPruningEnabled: boolean;
  hasSimControlSnapshot: boolean;
};

export type FrameActions = {
  pushFrame: (payload: FramePayload) => void;
  setStatus: (status: ConnectionStatus) => void;
  setShowVelocityVectors: (show: boolean) => void;
  setShowAccelerationVectors: (show: boolean) => void;
  setShowOrbitTrails: (show: boolean) => void;
  setShowWorldGrid: (show: boolean) => void;
  setInvertLook: (invert: boolean) => void;
  setCameraBaseMoveSpeed: (speed: number) => void;
  setSimControlSnapshot: (snapshot: SimControlSnapshot) => void;
  reset: () => void;
};

const DEFAULT_SIM_CONTROL_STATE: SimControlSnapshot = {
  paused: false,
  dt: 0.016667,
  pruningEnabled: true,
  defaultDt: 0.016667,
  defaultPruningEnabled: true
};

export const useFrameStore = create<FrameState & FrameActions>((set, get) => ({
  frame: 0,
  bodyCount: 0,
  positions: null,
  velocities: null,
  fps: 0,
  status: 'disconnected',
  totalBytes: 0,
  lastFrameTime: performance.now(),
  showVelocityVectors: false,
  showAccelerationVectors: false,
  showOrbitTrails: ORBIT_TRAILS_ENABLED,
  showWorldGrid: WORLD_GRID_ENABLED,
  invertLook: false,
  cameraBaseMoveSpeed: 300,
  simPaused: DEFAULT_SIM_CONTROL_STATE.paused,
  simDt: DEFAULT_SIM_CONTROL_STATE.dt,
  simPruningEnabled: DEFAULT_SIM_CONTROL_STATE.pruningEnabled,
  simDefaultDt: DEFAULT_SIM_CONTROL_STATE.defaultDt,
  simDefaultPruningEnabled: DEFAULT_SIM_CONTROL_STATE.defaultPruningEnabled,
  hasSimControlSnapshot: false,
  pushFrame: ({ frame, bodyCount, bodies, receivedAt, bytes }) => {
    const prev = get();
    const dt = receivedAt - prev.lastFrameTime;
    const fps = dt > 0 ? 1000 / dt : prev.fps;
    const valueCount = bodyCount * 3;

    let positions = prev.positions;
    if (!positions || positions.length !== valueCount) {
      positions = new Float32Array(valueCount);
    }

    let velocities = prev.velocities;
    if (!velocities || velocities.length !== valueCount) {
      velocities = new Float32Array(valueCount);
    }

    for (let bodyIndex = 0, positionIndex = 0, velocityIndex = 0; bodyIndex < bodyCount; bodyIndex += 1) {
      const sourceIndex = bodyIndex * 6;
      positions[positionIndex++] = bodies[sourceIndex];
      positions[positionIndex++] = bodies[sourceIndex + 1];
      positions[positionIndex++] = bodies[sourceIndex + 2];

      velocities[velocityIndex++] = bodies[sourceIndex + 3];
      velocities[velocityIndex++] = bodies[sourceIndex + 4];
      velocities[velocityIndex++] = bodies[sourceIndex + 5];
    }

    set({
      frame,
      bodyCount,
      positions,
      velocities,
      fps,
      lastFrameTime: receivedAt,
      totalBytes: prev.totalBytes + bytes
    });
  },
  setStatus: (status: ConnectionStatus) =>
    set((state) => ({
      status,
      hasSimControlSnapshot: status === 'connected' ? state.hasSimControlSnapshot : false
    })),
  setShowVelocityVectors: (show: boolean) => set({ showVelocityVectors: show }),
  setShowAccelerationVectors: (show: boolean) => set({ showAccelerationVectors: show }),
  setShowOrbitTrails: (show: boolean) => set({ showOrbitTrails: show }),
  setShowWorldGrid: (show: boolean) => set({ showWorldGrid: show }),
  setInvertLook: (invert: boolean) => set({ invertLook: invert }),
  setCameraBaseMoveSpeed: (speed: number) =>
    set({
      cameraBaseMoveSpeed: Number.isFinite(speed) ? Math.max(10, Math.min(1_000_000, speed)) : 300
    }),
  setSimControlSnapshot: (snapshot: SimControlSnapshot) =>
    set({
      simPaused: snapshot.paused,
      simDt: snapshot.dt,
      simPruningEnabled: snapshot.pruningEnabled,
      simDefaultDt: snapshot.defaultDt,
      simDefaultPruningEnabled: snapshot.defaultPruningEnabled,
      hasSimControlSnapshot: true
    }),
  reset: () =>
    set({
      frame: 0,
      bodyCount: 0,
      positions: null,
      velocities: null,
      fps: 0,
      status: 'disconnected',
      totalBytes: 0,
      lastFrameTime: performance.now(),
      showVelocityVectors: false,
      showAccelerationVectors: false,
      showOrbitTrails: ORBIT_TRAILS_ENABLED,
      showWorldGrid: WORLD_GRID_ENABLED,
      invertLook: false,
      cameraBaseMoveSpeed: 300,
      simPaused: DEFAULT_SIM_CONTROL_STATE.paused,
      simDt: DEFAULT_SIM_CONTROL_STATE.dt,
      simPruningEnabled: DEFAULT_SIM_CONTROL_STATE.pruningEnabled,
      simDefaultDt: DEFAULT_SIM_CONTROL_STATE.defaultDt,
      simDefaultPruningEnabled: DEFAULT_SIM_CONTROL_STATE.defaultPruningEnabled,
      hasSimControlSnapshot: false
    })
}));
