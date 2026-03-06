import { create } from 'zustand';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type FramePayload = {
  frame: number;
  bodyCount: number;
  positions: Float32Array;
  velocities: Float32Array;
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
  invertLook: boolean;
  cameraBaseMoveSpeed: number;
};

export type FrameActions = {
  pushFrame: (payload: FramePayload) => void;
  setStatus: (status: ConnectionStatus) => void;
  setShowVelocityVectors: (show: boolean) => void;
  setShowAccelerationVectors: (show: boolean) => void;
  setInvertLook: (invert: boolean) => void;
  setCameraBaseMoveSpeed: (speed: number) => void;
  reset: () => void;
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
  invertLook: false,
  cameraBaseMoveSpeed: 300,
  pushFrame: ({ frame, bodyCount, positions, velocities, receivedAt, bytes }) => {
    const prev = get();
    const dt = receivedAt - prev.lastFrameTime;
    const fps = dt > 0 ? 1000 / dt : prev.fps;
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
  setStatus: (status: ConnectionStatus) => set({ status }),
  setShowVelocityVectors: (show: boolean) => set({ showVelocityVectors: show }),
  setShowAccelerationVectors: (show: boolean) => set({ showAccelerationVectors: show }),
  setInvertLook: (invert: boolean) => set({ invertLook: invert }),
  setCameraBaseMoveSpeed: (speed: number) =>
    set({
      cameraBaseMoveSpeed: Number.isFinite(speed) ? Math.max(10, Math.min(1_000_000, speed)) : 300
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
      invertLook: false,
      cameraBaseMoveSpeed: 300
    })
}));
