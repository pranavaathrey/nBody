// Generated from schema/frame_sample.fbs (manually copied for browser use)
import * as flatbuffers from 'flatbuffers';

export class FrameSample {
  bb: flatbuffers.ByteBuffer | null = null;
  bb_pos = 0;

  __init(i: number, bb: flatbuffers.ByteBuffer): FrameSample {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }

  static getRootAsFrameSample(bb: flatbuffers.ByteBuffer, obj?: FrameSample): FrameSample {
    return (obj || new FrameSample()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
  }

  static bufferHasIdentifier(bb: flatbuffers.ByteBuffer): boolean {
    return bb.__has_identifier('NBFR');
  }

  frame(): number {
    const o = this.bb!.__offset(this.bb_pos, 4);
    return o ? this.bb!.readUint32(this.bb_pos + o) : 0;
  }

  bodyCount(): number {
    const o = this.bb!.__offset(this.bb_pos, 6);
    return o ? this.bb!.readUint32(this.bb_pos + o) : 0;
  }

  bodies(index: number): number | null {
    const o = this.bb!.__offset(this.bb_pos, 8);
    return o ? this.bb!.readFloat32(this.bb!.__vector(this.bb_pos + o) + index * 4) : null;
  }

  bodiesLength(): number {
    const o = this.bb!.__offset(this.bb_pos, 8);
    return o ? this.bb!.__vector_len(this.bb_pos + o) : 0;
  }

  bodiesArray(): Float32Array | null {
    const o = this.bb!.__offset(this.bb_pos, 8);
    if (!o) return null;
    const start = this.bb!.__vector(this.bb_pos + o);
    const length = this.bb!.__vector_len(this.bb_pos + o);
    // Account for a non-zero byteOffset when the buffer is a subarray view.
    const bytes = this.bb!.bytes();
    const byteOffset = bytes.byteOffset + start;
    const byteLength = bytes.buffer.byteLength;
    // Bounds guard to avoid RangeError on malformed / truncated frames.
    if (byteOffset < 0 || byteOffset + length * 4 > byteLength) return null;
    try {
      return new Float32Array(bytes.buffer, byteOffset, length);
    } catch {
      return null;
    }
  }

  static getFullyQualifiedName(): string {
    return 'nbody.FrameSample';
  }
}
