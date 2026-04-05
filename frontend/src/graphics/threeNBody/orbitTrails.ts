import { Color3, LinesMesh, Scene, VertexBuffer } from '@babylonjs/core';
import {
  ORBIT_TRAIL_HEAD_ALPHA,
  ORBIT_TRAIL_HISTORY_POINTS,
  ORBIT_TRAIL_SAMPLE_STRIDE,
  ORBIT_TRAIL_TAIL_ALPHA
} from '../../lib/config';
import { randomIndexedColor, turboColor } from './color';
import { clamp01 } from './math';

export type OrbitTrailRenderTheme = 'default' | 'stable-orbits';

export type OrbitTrailManager = {
  update: (
    frame: number,
    positions: Float32Array,
    speeds: Float32Array,
    count: number,
    speedMin: number,
    speedSpan: number
  ) => void;
  clear: () => void;
  dispose: () => void;
};

function finiteOrDefault(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function gradeTrailColor(speedT: number, out: Color3): void {
  const gradedT = 0.9 * Math.pow(clamp01(speedT), 0.82);
  turboColor(gradedT, out);

  const luma = out.r * 0.2126 + out.g * 0.7152 + out.b * 0.0722;
  const saturationBoost = 1.28;
  const valueScale = 0.9;
  out.r = clamp01((luma + (out.r - luma) * saturationBoost) * valueScale);
  out.g = clamp01((luma + (out.g - luma) * saturationBoost) * valueScale);
  out.b = clamp01((luma + (out.b - luma) * saturationBoost) * valueScale);
}

export function createOrbitTrailManager(
  scene: Scene,
  renderTheme: OrbitTrailRenderTheme = 'default',
  stableColorSeed = 0
): OrbitTrailManager {
  const useStableOrbitTheme = renderTheme === 'stable-orbits';

  const baseHistoryPoints = Math.max(2, Math.floor(finiteOrDefault(ORBIT_TRAIL_HISTORY_POINTS, 24)));
  const baseSampleStride = Math.max(1, Math.floor(finiteOrDefault(ORBIT_TRAIL_SAMPLE_STRIDE, 1)));
  const tailAlpha = useStableOrbitTheme
    ? 0.0
    : clamp01(finiteOrDefault(ORBIT_TRAIL_TAIL_ALPHA, 0.05));
  const headAlpha = useStableOrbitTheme
    ? 0.62
    : clamp01(finiteOrDefault(ORBIT_TRAIL_HEAD_ALPHA, 0.9));

  const lowBodyCountThreshold = 256;
  const lowBodyHistoryMultiplier = 150;
  const lowBodyMinHistoryPoints = 384;
  const lowBodyMaxTotalTrailPoints = 1_500_000;
  const lowBodyAbsoluteMaxHistoryPoints = 16_384;
  const lowBodySampleStride = 1;

  const tmpColor = new Color3();

  let trailMesh: LinesMesh | null = null;
  let activeBodyCount = 0;
  let activeHistoryPoints = 0;
  let activeSampleStride = baseSampleStride;
  let renderPositions = new Float32Array(0);
  let renderColors = new Float32Array(0);
  let historyPositions = new Float32Array(0);
  let historySpeeds = new Float32Array(0);
  let writeIndices = new Uint32Array(0);
  let sampleCounts = new Uint32Array(0);
  let lastSeenFrame = -1;

  const disposeMesh = () => {
    if (!trailMesh) return;
    trailMesh.dispose(false, true);
    trailMesh = null;
  };

  const resetHistory = () => {
    writeIndices.fill(0);
    sampleCounts.fill(0);
    lastSeenFrame = -1;
    if (trailMesh) {
      trailMesh.setEnabled(false);
    }
  };

  const resolveTrailDetail = (count: number) => {
    if (count < lowBodyCountThreshold) {
      const boostedHistoryPoints = Math.floor(baseHistoryPoints * lowBodyHistoryMultiplier);
      const maxHistoryPointsFromBudget = Math.max(
        baseHistoryPoints,
        Math.floor(lowBodyMaxTotalTrailPoints / Math.max(1, count))
      );
      return {
        historyPoints: Math.min(
          lowBodyAbsoluteMaxHistoryPoints,
          maxHistoryPointsFromBudget,
          Math.max(lowBodyMinHistoryPoints, boostedHistoryPoints)
        ),
        sampleStride: lowBodySampleStride
      };
    }

    return {
      historyPoints: baseHistoryPoints,
      sampleStride: baseSampleStride
    };
  };

  const allocateForBodies = (count: number, historyPoints: number, sampleStride: number) => {
    disposeMesh();

    activeBodyCount = count;
    activeHistoryPoints = historyPoints;
    activeSampleStride = sampleStride;
    const vertexCount = count * historyPoints;
    const positionCount = vertexCount * 3;
    const colorCount = vertexCount * 4;
    const indexCount = count * (historyPoints - 1) * 2;

    renderPositions = new Float32Array(positionCount);
    renderColors = new Float32Array(colorCount);
    historyPositions = new Float32Array(positionCount);
    historySpeeds = new Float32Array(vertexCount);
    writeIndices = new Uint32Array(count);
    sampleCounts = new Uint32Array(count);

    const indices = new Uint32Array(indexCount);
    let indexOffset = 0;
    for (let body = 0; body < count; body++) {
      const bodyVertexBase = body * historyPoints;
      for (let point = 0; point < historyPoints - 1; point++) {
        indices[indexOffset++] = bodyVertexBase + point;
        indices[indexOffset++] = bodyVertexBase + point + 1;
      }
    }

    trailMesh = new LinesMesh('orbit-trails', scene, null, undefined, undefined, true, true);
    trailMesh.isPickable = false;
    trailMesh.alwaysSelectAsActiveMesh = true;
    trailMesh.renderingGroupId = useStableOrbitTheme ? 0 : 0;
    trailMesh.setVerticesData(VertexBuffer.PositionKind, renderPositions, true, 3);
    trailMesh.setVerticesData(VertexBuffer.ColorKind, renderColors, true, 4);
    trailMesh.setIndices(indices);
    trailMesh.setEnabled(false);

    lastSeenFrame = -1;
  };

  const appendSamples = (positions: Float32Array, speeds: Float32Array) => {
    for (let body = 0; body < activeBodyCount; body++) {
      const writeIndex = writeIndices[body];
      const historySlot = body * activeHistoryPoints + writeIndex;
      const historyPosBase = historySlot * 3;
      const srcPosBase = body * 3;

      historyPositions[historyPosBase] = positions[srcPosBase];
      historyPositions[historyPosBase + 1] = positions[srcPosBase + 1];
      historyPositions[historyPosBase + 2] = positions[srcPosBase + 2];
      historySpeeds[historySlot] = speeds[body];

      let nextWrite = writeIndex + 1;
      if (nextWrite >= activeHistoryPoints) nextWrite = 0;
      writeIndices[body] = nextWrite;

      if (sampleCounts[body] < activeHistoryPoints) {
        sampleCounts[body] += 1;
      }
    }
  };

  const rebuildRenderData = (
    speedMin: number,
    speedSpan: number,
    livePositions: Float32Array,
    liveSpeeds: Float32Array
  ): boolean => {
    const invSpeedSpan = speedSpan > 1e-6 ? 1 / speedSpan : 0;
    let posOffset = 0;
    let colorOffset = 0;
    let hasRenderableSegments = false;

    for (let body = 0; body < activeBodyCount; body++) {
      const sampleCount = sampleCounts[body];
      const writeIndex = writeIndices[body];
      const bodyHistoryBase = body * activeHistoryPoints;
      const oldestIndex =
        sampleCount > 0 ? (writeIndex + activeHistoryPoints - sampleCount) % activeHistoryPoints : 0;
      const liveBase = body * 3;
      const liveX = livePositions[liveBase];
      const liveY = livePositions[liveBase + 1];
      const liveZ = livePositions[liveBase + 2];
      const liveSpeed = liveSpeeds[body];
      const liveT = invSpeedSpan > 0 ? clamp01((liveSpeed - speedMin) * invSpeedSpan) : 0;
      if (useStableOrbitTheme) {
        randomIndexedColor(body, tmpColor, stableColorSeed);
      } else {
        gradeTrailColor(liveT, tmpColor);
      }

      const sampledPointsToRender = Math.min(sampleCount, activeHistoryPoints - 1);
      const droppedSamples = sampleCount - sampledPointsToRender;
      const sampledStartIndex =
        sampleCount > 0 ? (oldestIndex + droppedSamples) % activeHistoryPoints : 0;

      let renderPointCount = 0;
      let collapseX = liveX;
      let collapseY = liveY;
      let collapseZ = liveZ;

      for (let point = 0; point < sampledPointsToRender; point++) {
        const historyIndex = (sampledStartIndex + point) % activeHistoryPoints;
        const historySlot = bodyHistoryBase + historyIndex;
        const historyPosBase = historySlot * 3;

        renderPositions[posOffset++] = historyPositions[historyPosBase];
        renderPositions[posOffset++] = historyPositions[historyPosBase + 1];
        renderPositions[posOffset++] = historyPositions[historyPosBase + 2];

        if (useStableOrbitTheme) {
          randomIndexedColor(body, tmpColor, stableColorSeed);
        } else {
          const speed = historySpeeds[historySlot];
          const t = invSpeedSpan > 0 ? clamp01((speed - speedMin) * invSpeedSpan) : 0;
          gradeTrailColor(t, tmpColor);
        }

        const gradient = sampleCount > 1 ? point / (sampleCount - 1) : 1;
        if (useStableOrbitTheme) {
          const intensityRamp = 0.03 + 2.6 * Math.pow(gradient, 3.2);
          const alphaRamp = headAlpha * Math.pow(gradient, 3.4);
          renderColors[colorOffset++] = tmpColor.r * intensityRamp;
          renderColors[colorOffset++] = tmpColor.g * intensityRamp;
          renderColors[colorOffset++] = tmpColor.b * intensityRamp;
          renderColors[colorOffset++] = alphaRamp;
        } else {
          const alpha = tailAlpha + (headAlpha - tailAlpha) * gradient;
          renderColors[colorOffset++] = tmpColor.r;
          renderColors[colorOffset++] = tmpColor.g;
          renderColors[colorOffset++] = tmpColor.b;
          renderColors[colorOffset++] = alpha;
        }
        renderPointCount += 1;
      }

      if (sampledPointsToRender > 0) {
        renderPositions[posOffset++] = liveX;
        renderPositions[posOffset++] = liveY;
        renderPositions[posOffset++] = liveZ;
        if (useStableOrbitTheme) {
          const liveIntensity = 3.0;
          renderColors[colorOffset++] = tmpColor.r * liveIntensity;
          renderColors[colorOffset++] = tmpColor.g * liveIntensity;
          renderColors[colorOffset++] = tmpColor.b * liveIntensity;
          renderColors[colorOffset++] = headAlpha;
        } else {
          renderColors[colorOffset++] = tmpColor.r;
          renderColors[colorOffset++] = tmpColor.g;
          renderColors[colorOffset++] = tmpColor.b;
          renderColors[colorOffset++] = headAlpha;
        }
        renderPointCount += 1;
      }

      if (renderPointCount > 1) hasRenderableSegments = true;

      // Collapse all unsampled slots at the head with alpha 0 so the reserved indices stay invisible.
      for (let point = renderPointCount; point < activeHistoryPoints; point++) {
        renderPositions[posOffset++] = collapseX;
        renderPositions[posOffset++] = collapseY;
        renderPositions[posOffset++] = collapseZ;
        renderColors[colorOffset++] = 0;
        renderColors[colorOffset++] = 0;
        renderColors[colorOffset++] = 0;
        renderColors[colorOffset++] = 0;
      }
    }

    return hasRenderableSegments;
  };

  const update: OrbitTrailManager['update'] = (
    frame,
    positions,
    speeds,
    count,
    speedMin,
    speedSpan
  ) => {
    if (count <= 0) {
      resetHistory();
      return;
    }

    const nextDetail = resolveTrailDetail(count);
    const detailChanged =
      nextDetail.historyPoints !== activeHistoryPoints ||
      nextDetail.sampleStride !== activeSampleStride;

    if (count !== activeBodyCount || !trailMesh || detailChanged) {
      allocateForBodies(count, nextDetail.historyPoints, nextDetail.sampleStride);
    }

    if (frame < lastSeenFrame) {
      resetHistory();
    }

    const isNewFrame = frame > lastSeenFrame;
    if (isNewFrame) {
      lastSeenFrame = frame;
    }

    if (!trailMesh) {
      return;
    }

    if (isNewFrame && frame % activeSampleStride === 0) {
      appendSamples(positions, speeds);
    }

    const hasRenderableSegments = rebuildRenderData(speedMin, speedSpan, positions, speeds);

    trailMesh.updateVerticesData(VertexBuffer.PositionKind, renderPositions, false, false);
    trailMesh.updateVerticesData(VertexBuffer.ColorKind, renderColors, false, false);
    trailMesh.setEnabled(hasRenderableSegments);
  };

  const clear = () => {
    resetHistory();
  };

  const dispose = () => {
    disposeMesh();
  };

  return {
    update,
    clear,
    dispose
  };
}
