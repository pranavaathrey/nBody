import { ByteBuffer } from 'flatbuffers';
import { FrameSample } from '../flatbuffers/frame_sample_generated';
import type { FramePayload } from '../state/useFrameStore';

// Decode a single length-delimited FlatBuffer frame into renderable positions and velocities.
export function decodeFrame(buf: Uint8Array): FramePayload | null {
  const bb = new ByteBuffer(buf);
  if (!FrameSample.bufferHasIdentifier(bb)) return null;

  const frame = FrameSample.getRootAsFrameSample(bb);
  const bodyCount = frame.bodyCount();
  const bodies = frame.bodiesArray();
  if (!bodies || bodies.length < bodyCount * 6) {
    const debug: Record<string, number | string> = {
      bodyCount,
      len: bodies ? bodies.length : 0,
      bufLen: buf.byteLength
    };
    try {
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const root = view.getUint32(0, true);
      const vtable = root - view.getInt32(root, true);
      const bodiesOff = view.getUint16(vtable + 8, true);
      const bodiesField = root + bodiesOff;
      const rel = view.getUint32(bodiesField, true);
      const vecStart = bodiesField + rel;
      const vecLen = view.getUint32(vecStart, true);
      Object.assign(debug, { root, vtable, bodiesOff, rel, vecLen });
      const byteOffset = buf.byteOffset + vecStart + 4; // start of vector payload
      const end = byteOffset + vecLen * 4;
      Object.assign(debug, {
        bufByteOffset: buf.byteOffset,
        bufBufferLen: buf.buffer.byteLength,
        vecDataOffset: byteOffset,
        vecDataEnd: end
      });
    } catch (e) {
      debug['parseError'] = (e as Error).message;
    }
    console.warn('[frames] bodies array missing/short', debug);
    return null;
  }

  const positions = new Float32Array(bodyCount * 3);
  const velocities = new Float32Array(bodyCount * 3);
  for (let i = 0, j = 0, k = 0; i < bodyCount; i += 1) {
    const base = i * 6;
    positions[j++] = bodies[base];
    positions[j++] = bodies[base + 1];
    positions[j++] = bodies[base + 2];

    const vx = bodies[base + 3];
    const vy = bodies[base + 4];
    const vz = bodies[base + 5];
    velocities[k++] = vx;
    velocities[k++] = vy;
    velocities[k++] = vz;
  }

  return {
    frame: frame.frame(),
    bodyCount,
    positions,
    velocities,
    receivedAt: performance.now(),
    bytes: buf.byteLength
  };
}
