// Websocket URL
export const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://127.0.0.1:8080/frames';

export const MAX_QUEUE = 2;

// Switch to LOD dots when body is outside this distance from camera.
export const BILLBOARD_SWITCH_DISTANCE = 900;

// Constant world-space radius for rendered body spheres.
export const BODY_SPHERE_RADIUS = 1;

// Independent world-space scale reference for velocity/acceleration vectors.
export const VECTOR_OVERLAY_SCALE_RADIUS = 1.5;
