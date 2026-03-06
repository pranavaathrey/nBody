import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  Scene,
  StandardMaterial,
  Vector3,
  VertexBuffer
} from '@babylonjs/core';
import { turboColor } from './color';
import { clamp01 } from './math';

export type BodyInstancesRenderer = {
  mesh: Mesh;
  material: PBRMaterial;
  pointMesh: Mesh;
  pointMaterial: StandardMaterial;
  setBodyRadius: (value: number) => void;
  update: (
    positions: Float32Array,
    speeds: Float32Array,
    count: number,
    speedMin: number,
    speedSpan: number,
    cameraPos: Vector3,
    billboardDistanceSq: number
  ) => void;
  dispose: () => void;
};

export function createBodyInstancesRenderer(scene: Scene): BodyInstancesRenderer {
  const mesh = MeshBuilder.CreateSphere('body', { diameter: 2, segments: 16 }, scene);
  const material = new PBRMaterial('body-mat', scene);
  material.albedoColor = Color3.White();
  material.metallic = 0.99;
  material.roughness = 0.5;
  material.emissiveColor = Color3.Black();
  material.useRoughnessFromMetallicTextureAlpha = false;
  mesh.material = material;
  mesh.thinInstanceEnablePicking = false;

  const pointMesh = new Mesh('body-points', scene);
  const pointMaterial = new StandardMaterial('body-points-mat', scene);
  pointMaterial.disableLighting = true;
  pointMaterial.emissiveColor = Color3.White();
  pointMaterial.pointsCloud = true;
  pointMaterial.pointSize = 1.25;
  pointMaterial.alpha = 0.5;
  // Keep translucent distant points from self-occluding by unstable depth writes.
  pointMaterial.disableDepthWrite = true;
  pointMaterial.backFaceCulling = false;
  pointMesh.material = pointMaterial;
  pointMesh.isPickable = false;
  pointMesh.alwaysSelectAsActiveMesh = true;
  pointMesh.setEnabled(false);

  const identityQuat = Quaternion.Identity();
  const tmpMatrix = new Matrix();
  const tmpPos = new Vector3();
  const tmpScale = new Vector3(1, 1, 1);
  const tmpColor = new Color3();

  let bodyRadius = 0.01;
  let matrixData = new Float32Array(0);
  let colorData = new Float32Array(0);
  let pointPositions = new Float32Array(0);
  let pointColors = new Float32Array(0);
  let pointIndices: number[] = [];

  const setBodyRadius = (value: number) => {
    bodyRadius = value;
  };

  const update = (
    positions: Float32Array,
    speeds: Float32Array,
    count: number,
    speedMin: number,
    speedSpan: number,
    cameraPos: Vector3,
    billboardDistanceSq: number
  ) => {
    if (matrixData.length !== count * 16) {
      matrixData = new Float32Array(count * 16);
      mesh.thinInstanceSetBuffer('matrix', matrixData, 16, false);
      mesh.thinInstanceAllowAutomaticStaticBufferRecreation = true;
    }

    if (colorData.length !== count * 4) {
      colorData = new Float32Array(count * 4);
      mesh.thinInstanceSetBuffer('color', colorData, 4, false);
    }

    if (pointPositions.length !== count * 3) {
      pointPositions = new Float32Array(count * 3);
      pointColors = new Float32Array(count * 4);
      pointIndices = new Array<number>(count);
      for (let i = 0; i < count; i++) pointIndices[i] = i;
      pointMesh.setVerticesData(VertexBuffer.PositionKind, pointPositions, true, 3);
      pointMesh.setVerticesData(VertexBuffer.ColorKind, pointColors, true, 4);
      pointMesh.setIndices(pointIndices);
    }

    tmpScale.set(bodyRadius, bodyRadius, bodyRadius);
    let sphereCount = 0;
    let farBodyCount = 0;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const px = positions[idx];
      const py = positions[idx + 1];
      const pz = positions[idx + 2];
      const dx = px - cameraPos.x;
      const dy = py - cameraPos.y;
      const dz = pz - cameraPos.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;

      const t = clamp01((speeds[i] - speedMin) / speedSpan);
      turboColor(t, tmpColor);
      const c = i * 4;

      const p = i * 3;
      pointPositions[p] = px;
      pointPositions[p + 1] = py;
      pointPositions[p + 2] = pz;

      pointColors[c] = tmpColor.r;
      pointColors[c + 1] = tmpColor.g;
      pointColors[c + 2] = tmpColor.b;

      if (distanceSq > billboardDistanceSq) {
        pointColors[c + 3] = 0.5;
        farBodyCount += 1;
      } else {
        pointColors[c + 3] = 0;
        tmpPos.set(px, py, pz);
        Matrix.ComposeToRef(tmpScale, identityQuat, tmpPos, tmpMatrix);
        tmpMatrix.copyToArray(matrixData, sphereCount * 16);

        const sphereColor = sphereCount * 4;
        colorData[sphereColor] = tmpColor.r;
        colorData[sphereColor + 1] = tmpColor.g;
        colorData[sphereColor + 2] = tmpColor.b;
        colorData[sphereColor + 3] = 1;
        sphereCount += 1;
      }
    }

    mesh.thinInstanceCount = sphereCount;
    mesh.thinInstanceBufferUpdated('matrix');
    mesh.thinInstanceBufferUpdated('color');

    pointMesh.updateVerticesData(VertexBuffer.PositionKind, pointPositions, false, false);
    pointMesh.updateVerticesData(VertexBuffer.ColorKind, pointColors, false, false);
    pointMesh.setEnabled(farBodyCount > 0);
    mesh.setEnabled(sphereCount > 0);
  };

  const dispose = () => {
    mesh.dispose(false, true);
    material.dispose();
    pointMesh.dispose(false, true);
    pointMaterial.dispose();
  };

  return {
    mesh,
    material,
    pointMesh,
    pointMaterial,
    setBodyRadius,
    update,
    dispose
  };
}
