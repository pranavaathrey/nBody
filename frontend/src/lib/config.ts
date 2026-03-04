// Prefer explicit IPv4 localhost to avoid ::1/IPv6 resolution mismatches in some browsers.
export const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://127.0.0.1:8080/frames';
export const MAX_QUEUE = 2;
