import { create } from 'zustand';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type FramePayload = {
  frame: number;
  bodyCount: number;
  positions: Float32Array;
  receivedAt: number;
  bytes: number;
};

export type FrameState = {
  frame: number;
  bodyCount: number;
  positions: Float32Array | null;
  fps: number;
  status: ConnectionStatus;
  totalBytes: number;
  lastFrameTime: number;
};

export type FrameActions = {
  pushFrame: (payload: FramePayload) => void;
  setStatus: (status: ConnectionStatus) => void;
  reset: () => void;
};

export const useFrameStore = create<FrameState & FrameActions>((set, get) => ({
  frame: 0,
  bodyCount: 0,
  positions: null,
  fps: 0,
  status: 'disconnected',
  totalBytes: 0,
  lastFrameTime: performance.now(),
  pushFrame: ({ frame, bodyCount, positions, receivedAt, bytes }) => {
    const prev = get();
    const dt = receivedAt - prev.lastFrameTime;
    const fps = dt > 0 ? 1000 / dt : prev.fps;
    set({
      frame,
      bodyCount,
      positions,
      fps,
      lastFrameTime: receivedAt,
      totalBytes: prev.totalBytes + bytes
    });
  },
  setStatus: (status: ConnectionStatus) => set({ status }),
  reset: () =>
    set({
      frame: 0,
      bodyCount: 0,
      positions: null,
      fps: 0,
      status: 'disconnected',
      totalBytes: 0,
      lastFrameTime: performance.now()
    })
}));
