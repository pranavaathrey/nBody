import { Color3, Matrix, Mesh, MeshBuilder, PBRMaterial, Quaternion, Scene, Vector3 } from '@babylonjs/core';
import { turboColor } from './color';
import { clamp01 } from './math';

type VectorOverlay = {
  mesh: Mesh;
  material: PBRMaterial;
  matrixData: Float32Array;
  colorData: Float32Array;
};

export type VectorOverlayManager = {
  update: (
    name: string,
    positions: Float32Array,
    vectors: Float32Array,
    magnitudes: Float32Array,
    count: number,
    speedMin: number,
    speedSpan: number,
    scaleRadius: number
  ) => void;
  clear: (name: string) => void;
  dispose: () => void;
};

export function createVectorOverlayManager(scene: Scene): VectorOverlayManager {
  const overlays = new Map<string, VectorOverlay>();

  const upAxis = Vector3.Up();
  const tmpMatrix = new Matrix();
  const tmpQuat = new Quaternion();
  const tmpVec = new Vector3();
  const tmpMid = new Vector3();
  const tmpScale = new Vector3(1, 1, 1);
  const tmpColor = new Color3();

  const ensureOverlay = (name: string): VectorOverlay => {
    const existing = overlays.get(name);
    if (existing) return existing;

    const shaft = MeshBuilder.CreateCylinder(`${name}-vector-shaft`, {
      height: 0.8,
      diameter: 3.5,
      tessellation: 8
    }, scene);
    shaft.position.y = -0.09;

    const tip = MeshBuilder.CreateCylinder(`${name}-vector-tip`, {
      height: 0.18,
      diameterTop: 0,
      diameterBottom: 12.5,
      tessellation: 8
    }, scene);
    tip.position.y = 0.41;

    const merged = Mesh.MergeMeshes([shaft, tip], true, true, undefined, false, true);
    if (!merged) {
      throw new Error('Failed to create arrow mesh for vector overlay');
    }

    merged.isPickable = false;
    merged.setEnabled(false);

    const material = new PBRMaterial(`${name}-vector-mat`, scene);
    material.albedoColor = Color3.White();
    material.metallic = 0;
    material.roughness = 0.95;
    material.emissiveColor = new Color3(0.02, 0.02, 0.02);

    merged.material = material;
    merged.thinInstanceEnablePicking = false;

    const overlay: VectorOverlay = {
      mesh: merged,
      material,
      matrixData: new Float32Array(0),
      colorData: new Float32Array(0)
    };

    overlays.set(name, overlay);
    return overlay;
  };

  const update: VectorOverlayManager['update'] = (
    name,
    positions,
    vectors,
    magnitudes,
    count,
    speedMin,
    speedSpan,
    scaleRadius
  ) => {
    const overlay = ensureOverlay(name);
    overlay.mesh.setEnabled(true);

    const matrixSize = count * 16;
    const colorSize = count * 4;

    if (overlay.matrixData.length !== matrixSize) {
      overlay.matrixData = new Float32Array(matrixSize);
      overlay.mesh.thinInstanceSetBuffer('matrix', overlay.matrixData, 16, false);
      overlay.mesh.thinInstanceAllowAutomaticStaticBufferRecreation = true;
    }

    if (overlay.colorData.length !== colorSize) {
      overlay.colorData = new Float32Array(colorSize);
      overlay.mesh.thinInstanceSetBuffer('color', overlay.colorData, 4, false);
    }

    const maxLen = Math.max(scaleRadius * 7.0, 0.01);
    const minLen = Math.max(scaleRadius * 0.18, maxLen * 0.01);
    const shaftRadius = Math.max(scaleRadius * 0.035, 0.00008);

    for (let i = 0; i < count; i++) {
      const base = i * 3;
      const px = positions[base];
      const py = positions[base + 1];
      const pz = positions[base + 2];
      const vx = vectors[base];
      const vy = vectors[base + 1];
      const vz = vectors[base + 2];

      const mag = magnitudes[i];
      const tBase = clamp01((mag - speedMin) / speedSpan);
      const t = Math.pow(tBase, 1.35);
      const length = mag > 1e-9 ? (minLen + (maxLen - minLen) * t) * 0.78 : minLen * 0.12;

      if (mag > 1e-9) {
        tmpVec.set(vx, vy, vz).normalize();
      } else {
        tmpVec.copyFrom(upAxis);
      }

      tmpMid.set(px, py, pz).addInPlace(tmpVec.scale(length * 0.5));
      Quaternion.FromUnitVectorsToRef(upAxis, tmpVec, tmpQuat);
      tmpScale.set(shaftRadius, length, shaftRadius);
      Matrix.ComposeToRef(tmpScale, tmpQuat, tmpMid, tmpMatrix);
      tmpMatrix.copyToArray(overlay.matrixData, i * 16);

      const c = i * 4;
      turboColor(tBase, tmpColor);
      overlay.colorData[c] = tmpColor.r;
      overlay.colorData[c + 1] = tmpColor.g;
      overlay.colorData[c + 2] = tmpColor.b;
      overlay.colorData[c + 3] = 0.95;
    }

    overlay.mesh.thinInstanceCount = count;
    overlay.mesh.thinInstanceBufferUpdated('matrix');
    overlay.mesh.thinInstanceBufferUpdated('color');
  };

  const clear = (name: string) => {
    const overlay = overlays.get(name);
    if (!overlay) return;
    overlay.mesh.thinInstanceCount = 0;
    overlay.mesh.setEnabled(false);
  };

  const dispose = () => {
    overlays.forEach((overlay) => {
      overlay.mesh.dispose(false, true);
      overlay.material.dispose();
    });
    overlays.clear();
  };

  return {
    update,
    clear,
    dispose
  };
}
