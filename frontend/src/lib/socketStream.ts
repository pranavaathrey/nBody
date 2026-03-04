import type { FramePayload } from '../state/useFrameStore';
import { decodeFrame } from './frameDecode';

export type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
export type FrameHandler = (frame: FramePayload) => void;

export type SocketControls = {
  close: () => void;
};

// Keep the client resilient: retry after transient failures and tolerate Blob/ArrayBuffer payloads.
export function startFrameWebSocket(
  url: string,
  onFrame: FrameHandler,
  onStatus?: StatusHandler,
  retryDelayMs = 250
): SocketControls {
  let ws: WebSocket | null = null;
  let carry = new Uint8Array(0);
  let stop = false;
  let retryTimer: number | null = null;
  let debugLogged = 0;

  const resetCarry = () => {
    carry = new Uint8Array(0);
  };

  const parseChunk = (chunk: ArrayBuffer) => {
    const incoming = new Uint8Array(chunk);
    const merged = new Uint8Array(carry.length + incoming.length);
    merged.set(carry);
    merged.set(incoming, carry.length);

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

    carry = merged.subarray(offset);
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

    ws = new WebSocket(url);
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

    ws.onmessage = async (ev: MessageEvent<ArrayBuffer | Blob>) => {
      const data = ev.data;
      if (data instanceof ArrayBuffer) {
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
    }
  };
}
