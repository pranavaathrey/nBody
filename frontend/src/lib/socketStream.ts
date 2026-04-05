import type { FramePayload } from '../state/useFrameStore';
import { decodeFrame } from './frameDecode';
import { parseSimControlMessage, type SimControlSnapshot } from './simControl';

export type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
export type FrameHandler = (frame: FramePayload) => void;
export type SimControlHandler = (snapshot: SimControlSnapshot) => void;

export type SocketControls = {
  close: () => void;
  sendText: (message: string) => boolean;
};

const EMPTY_UINT8_ARRAY = new Uint8Array(0);

function getPreferredWebSocketProtocol(): 'ws:' | 'wss:' {
  return window.location.protocol === 'https:' ? 'wss:' : 'ws:';
}

function normalizeWebSocketUrl(rawUrl: string, preferredProtocol: 'ws:' | 'wss:'): string {
  const trimmedUrl = rawUrl.trim();
  if (trimmedUrl.length === 0) {
    return trimmedUrl;
  }

  try {
    const parsed = new URL(trimmedUrl, window.location.origin);

    // Allow http(s) values while forcing websocket transport protocols.
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    }

    // Prevent mixed-content constructor failures on HTTPS deployments.
    if (preferredProtocol === 'wss:' && parsed.protocol === 'ws:') {
      parsed.protocol = 'wss:';
    }

    return parsed.toString();
  } catch {
    return trimmedUrl;
  }
}

export function resolveWebSocketUrl(configuredUrl?: string): string {
  const preferredWebSocketProtocol = getPreferredWebSocketProtocol();
  const defaultWebSocketUrl =
    `${preferredWebSocketProtocol}//${window.location.hostname}:8080/frames`;

  if (!configuredUrl || configuredUrl.trim().length === 0) {
    return defaultWebSocketUrl;
  }

  return normalizeWebSocketUrl(configuredUrl, preferredWebSocketProtocol);
}

export const WS_URL = resolveWebSocketUrl(import.meta.env.VITE_WS_URL);

export function startFrameWebSocket(
  url: string,
  onFrame: FrameHandler,
  onStatus?: StatusHandler,
  onSimControl?: SimControlHandler,
  retryDelayMs = 250
): SocketControls {
  let ws: WebSocket | null = null;
  let carry = EMPTY_UINT8_ARRAY;
  let stop = false;
  let retryTimer: number | null = null;
  let debugLogged = 0;

  const resetCarry = () => {
    carry = EMPTY_UINT8_ARRAY;
  };

  const setCarryFromOffset = (source: Uint8Array, offset: number) => {
    const remaining = source.length - offset;
    if (remaining <= 0) {
      carry = EMPTY_UINT8_ARRAY;
      return;
    }

    carry = new Uint8Array(remaining);
    carry.set(source.subarray(offset));
  };

  const parseChunk = (chunk: ArrayBuffer) => {
    const incoming = new Uint8Array(chunk);
    let merged = incoming;
    if (carry.length > 0) {
      merged = new Uint8Array(carry.length + incoming.length);
      merged.set(carry);
      merged.set(incoming, carry.length);
    }

    const view = new DataView(merged.buffer, merged.byteOffset, merged.byteLength);
    let offset = 0;

    while (offset + 4 <= merged.length) {
      const frameLength = view.getUint32(offset, true);
      // If the declared length is nonsensical, drop the buffer and resync.
      if (frameLength === 0 || frameLength > 10_000_000) {
        resetCarry();
        console.error('Failed to decode frame: unrealistic length', frameLength);
        return;
      }
      if (offset + 4 + frameLength > merged.length) break;
      const frameSlice = merged.subarray(offset + 4, offset + 4 + frameLength);
      try {
        const decoded = decodeFrame(frameSlice);
        if (decoded) {
          onFrame(decoded);
          if (debugLogged < 3) {
            console.info(
              '[frames] received',
              decoded.frame,
              'bodies',
              decoded.bodyCount,
              'bytes',
              frameSlice.byteLength
            );
            debugLogged += 1;
          }
        }
      } catch (err) {
        console.error('Failed to decode frame', err);
        resetCarry();
        return;
      }
      offset += 4 + frameLength;
    }

    setCarryFromOffset(merged, offset);
  };

  const cleanupRetry = () => {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const connect = () => {
    if (stop) return;
    cleanupRetry();
    resetCarry();
    onStatus?.('connecting');

    let nextSocket: WebSocket;
    try {
      nextSocket = new WebSocket(url);
    } catch (err) {
      console.error('Failed to create WebSocket', err);
      onStatus?.('error');
      if (!stop) retryTimer = window.setTimeout(connect, retryDelayMs);
      return;
    }

    ws = nextSocket;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => onStatus?.('connected');

    ws.onerror = (err) => {
      console.error('WebSocket error', err);
      onStatus?.('error');
    };

    ws.onclose = () => {
      resetCarry();
      onStatus?.('disconnected');
      if (!stop) retryTimer = window.setTimeout(connect, retryDelayMs);
    };

    ws.onmessage = async (ev: MessageEvent<ArrayBuffer | Blob | string>) => {
      const data = ev.data;
      if (typeof data === 'string') {
        const snapshot = parseSimControlMessage(data);
        if (snapshot) {
          onSimControl?.(snapshot);
        }
      } else if (data instanceof ArrayBuffer) {
        parseChunk(data);
      } else if (data instanceof Blob) {
        parseChunk(await data.arrayBuffer());
      }
    };
  };

  connect();

  return {
    close: () => {
      stop = true;
      cleanupRetry();
      ws?.close();
    },
    sendText: (message: string) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return false;
      }

      try {
        ws.send(message);
        return true;
      } catch (err) {
        console.error('Failed to send WebSocket message', err);
        return false;
      }
    }
  };
}
