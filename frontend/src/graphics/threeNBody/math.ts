import { Vector3 } from '@babylonjs/core';

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function computeBounds(positions: Float32Array, count: number, centerOut: Vector3): number {
  if (count === 0) {
    centerOut.set(0, 0, 0);
    return 1;
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    const x = positions[idx];
    const y = positions[idx + 1];
    const z = positions[idx + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  centerOut.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);

  let maxR2 = 0;
  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    const dx = positions[idx] - centerOut.x;
    const dy = positions[idx + 1] - centerOut.y;
    const dz = positions[idx + 2] - centerOut.z;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > maxR2) maxR2 = r2;
  }

  const radius = Math.sqrt(maxR2);
  return Number.isFinite(radius) && radius > 0 ? radius : 1;
}

export function percentileRange(
  values: Float32Array,
  count: number,
  lowPercent: number,
  highPercent: number
): [number, number] {
  if (count <= 0) return [0, 1];

  const sorted = values.slice(0, count);
  sorted.sort();

  const lowIndex = Math.floor((count - 1) * lowPercent);
  const highIndex = Math.floor((count - 1) * highPercent);
  const low = sorted[lowIndex];
  const high = sorted[highIndex];

  if (!Number.isFinite(low) || !Number.isFinite(high)) return [0, 1];
  if (high <= low) return [low, low + 1];
  return [low, high];
}
