// WebSocket URL. Default to the current page host.
export const WS_URL =
	import.meta.env.VITE_WS_URL ?? `ws://${window.location.hostname}:8080/frames`;

export const MAX_QUEUE = 2;

// Switch to LOD dots when body is outside this distance from camera.
// On mobile we use a shorter distance for better performance.
export const DESKTOP_BILLBOARD_SWITCH_DISTANCE = 900;
export const MOBILE_BILLBOARD_SWITCH_DISTANCE = 500;

// Constant world-space radius for rendered body spheres.
export const BODY_SPHERE_RADIUS = 1;

// Independent world-space scale reference for velocity/acceleration vectors.
export const VECTOR_OVERLAY_SCALE_RADIUS = 1.5;

// Orbit trail rendering controls.
export const ORBIT_TRAILS_ENABLED = false;
export const ORBIT_TRAIL_HISTORY_POINTS = 24;
export const ORBIT_TRAIL_SAMPLE_STRIDE = 4;
export const ORBIT_TRAIL_HEAD_ALPHA = 0.6;
export const ORBIT_TRAIL_TAIL_ALPHA = 0;

// World-space XY grid controls.
export const WORLD_GRID_ENABLED = true;
export const WORLD_GRID_OPACITY = 0.003;

export const WORLD_GRID_MINOR_SPACING = 25;
export const WORLD_GRID_MAJOR_SPACING = 250;
export const WORLD_GRID_MINOR_PIXEL_WIDTH = 0.2;
export const WORLD_GRID_MAJOR_PIXEL_WIDTH = 1.1;

export const WORLD_GRID_HALF_SPAN = 6000;
export const WORLD_GRID_FADE_START_DISTANCE = 500;
export const WORLD_GRID_FADE_RANGE = 5000;
