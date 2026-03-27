import { ByteBuffer } from 'flatbuffers';
import { FrameSample } from '../flatbuffers/frame_sample_generated';
import type { FramePayload } from '../state/useFrameStore';

// Decode a single length-delimited FlatBuffer frame into a compact interleaved body buffer.
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

  return {
    frame: frame.frame(),
    bodyCount,
    bodies,
    receivedAt: performance.now(),
    bytes: buf.byteLength
  };
}
