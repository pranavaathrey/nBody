import { Color3 } from '@babylonjs/core';
import { clamp01 } from './math';

function fract(value: number): number {
  return value - Math.floor(value);
}

function hashToUnit(index: number, salt: number, seed: number): number {
  const seededSalt = salt + seed * 0.000013;
  const seededIndex = index + 1 + seed * 0.00011;
  const v = Math.sin(seededIndex * 12.9898 + seededSalt * 78.233) * 43758.5453123;
  return fract(v);
}

function hsvToRgb(h: number, s: number, v: number, out: Color3): void {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0:
      out.r = v;
      out.g = t;
      out.b = p;
      return;
    case 1:
      out.r = q;
      out.g = v;
      out.b = p;
      return;
    case 2:
      out.r = p;
      out.g = v;
      out.b = t;
      return;
    case 3:
      out.r = p;
      out.g = q;
      out.b = v;
      return;
    case 4:
      out.r = t;
      out.g = p;
      out.b = v;
      return;
    default:
      out.r = v;
      out.g = p;
      out.b = q;
      return;
  }
}

// Polynomial approximation of matplotlib's Turbo colormap.
export function turboColor(t: number, out: Color3): void {
  const x = clamp01(t);
  const x2 = x * x;
  const x3 = x2 * x;
  const x4 = x3 * x;
  const x5 = x4 * x;

  const r = 0.13572138 + 4.6153926 * x - 42.66032258 * x2 + 132.13108234 * x3 - 152.94239396 * x4 + 59.28637943 * x5;
  const g = 0.09140261 + 2.19418839 * x + 4.84296658 * x2 - 14.18503333 * x3 + 4.27729857 * x4 + 2.82956604 * x5;
  const b = 0.1066733 + 12.64194608 * x - 60.58204836 * x2 + 110.36276771 * x3 - 89.90310912 * x4 + 27.34824973 * x5;

  out.r = clamp01(r);
  out.g = clamp01(g);
  out.b = clamp01(b);
}

export function randomIndexedColor(index: number, out: Color3, seed = 0): void {
  const h = hashToUnit(index, 1.13, seed);
  const s = 0.58 + 0.36 * hashToUnit(index, 2.71, seed);
  const v = 0.75 + 0.25 * hashToUnit(index, 3.97, seed);
  hsvToRgb(h, clamp01(s), clamp01(v), out);
}
