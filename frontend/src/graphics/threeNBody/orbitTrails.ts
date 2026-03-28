import { Color3, LinesMesh, Scene, VertexBuffer } from '@babylonjs/core';
import {
  ORBIT_TRAIL_HEAD_ALPHA,
  ORBIT_TRAIL_HISTORY_POINTS,
  ORBIT_TRAIL_SAMPLE_STRIDE,
  ORBIT_TRAIL_TAIL_ALPHA
} from '../../lib/config';
import { turboColor } from './color';
import { clamp01 } from './math';

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

export function createOrbitTrailManager(scene: Scene): OrbitTrailManager {
  const baseHistoryPoints = Math.max(2, Math.floor(finiteOrDefault(ORBIT_TRAIL_HISTORY_POINTS, 24)));
  const baseSampleStride = Math.max(1, Math.floor(finiteOrDefault(ORBIT_TRAIL_SAMPLE_STRIDE, 1)));
  const tailAlpha = clamp01(finiteOrDefault(ORBIT_TRAIL_TAIL_ALPHA, 0.05));
  const headAlpha = clamp01(finiteOrDefault(ORBIT_TRAIL_HEAD_ALPHA, 0.9));

  const lowBodyCountThreshold = 256;
  const lowBodyHistoryMultiplier = 512;
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
  let lastLivePositions = new Float32Array(0);

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
    trailMesh.setVerticesData(VertexBuffer.PositionKind, renderPositions, true, 3);
    trailMesh.setVerticesData(VertexBuffer.ColorKind, renderColors, true, 4);
    trailMesh.setIndices(indices);
    trailMesh.setEnabled(false);

    lastSeenFrame = -1;
  };

  const recordLivePositions = (positions: Float32Array, count: number) => {
    const valueCount = count * 3;
    if (lastLivePositions.length !== valueCount) {
      lastLivePositions = new Float32Array(valueCount);
    }
    lastLivePositions.set(positions.subarray(0, valueCount));
  };

  const bodyDistanceSq = (
    positionsA: Float32Array,
    indexA: number,
    positionsB: Float32Array,
    indexB: number
  ) => {
    const offsetA = indexA * 3;
    const offsetB = indexB * 3;
    const dx = positionsA[offsetA] - positionsB[offsetB];
    const dy = positionsA[offsetA + 1] - positionsB[offsetB + 1];
    const dz = positionsA[offsetA + 2] - positionsB[offsetB + 2];
    return dx * dx + dy * dy + dz * dz;
  };

  const buildPrunedBodyMapping = (nextCount: number, nextPositions: Float32Array) => {
    const mapping = new Uint32Array(nextCount);
    if (lastLivePositions.length !== activeBodyCount * 3 || nextCount >= activeBodyCount) {
      for (let i = 0; i < nextCount; i++) {
        mapping[i] = i;
      }
      return mapping;
    }

    let previousCursor = 0;
    let remainingRemoved = activeBodyCount - nextCount;

    for (let nextIndex = 0; nextIndex < nextCount; nextIndex++) {
      const remainingNextBodies = nextCount - nextIndex;
      const maxCandidate = Math.min(
        activeBodyCount - remainingNextBodies,
        previousCursor + remainingRemoved
      );

      let bestCandidate = previousCursor;
      let bestDistance = bodyDistanceSq(lastLivePositions, previousCursor, nextPositions, nextIndex);

      for (let candidate = previousCursor + 1; candidate <= maxCandidate; candidate++) {
        const distance = bodyDistanceSq(lastLivePositions, candidate, nextPositions, nextIndex);
        if (distance < bestDistance) {
          bestCandidate = candidate;
          bestDistance = distance;
        }
      }

      mapping[nextIndex] = bestCandidate;
      remainingRemoved -= bestCandidate - previousCursor;
      previousCursor = bestCandidate + 1;
    }

    return mapping;
  };

  const migrateForReducedBodyCount = (nextCount: number, nextPositions: Float32Array) => {
    const previousActiveBodyCount = activeBodyCount;
    const previousHistoryPointCount = activeHistoryPoints;
    const previousHistoryPositions = historyPositions;
    const previousHistorySpeeds = historySpeeds;
    const previousWriteIndices = writeIndices;
    const previousSampleCounts = sampleCounts;
    const previousLastSeenFrame = lastSeenFrame;
    const bodyMapping = buildPrunedBodyMapping(nextCount, nextPositions);
    const nextDetail = resolveTrailDetail(nextCount);

    allocateForBodies(nextCount, nextDetail.historyPoints, nextDetail.sampleStride);

    for (let nextIndex = 0; nextIndex < nextCount; nextIndex++) {
      const previousIndex = Math.min(bodyMapping[nextIndex], previousActiveBodyCount - 1);
      const previousSampleCount = previousSampleCounts[previousIndex];
      const samplesToCopy = Math.min(previousSampleCount, activeHistoryPoints);

      if (samplesToCopy <= 0) {
        continue;
      }

      const previousWriteIndex = previousWriteIndices[previousIndex];
      const previousOldestIndex =
        (previousWriteIndex + previousHistoryPointCount - previousSampleCount) %
        previousHistoryPointCount;
      const droppedOldestSamples = previousSampleCount - samplesToCopy;
      const previousSourceStart =
        (previousOldestIndex + droppedOldestSamples) % previousHistoryPointCount;

      for (let sample = 0; sample < samplesToCopy; sample++) {
        const previousHistoryIndex = (previousSourceStart + sample) % previousHistoryPointCount;
        const previousHistorySlot = previousIndex * previousHistoryPointCount + previousHistoryIndex;
        const nextHistorySlot = nextIndex * activeHistoryPoints + sample;

        const previousHistoryPosBase = previousHistorySlot * 3;
        const nextHistoryPosBase = nextHistorySlot * 3;

        historyPositions[nextHistoryPosBase] = previousHistoryPositions[previousHistoryPosBase];
        historyPositions[nextHistoryPosBase + 1] = previousHistoryPositions[previousHistoryPosBase + 1];
        historyPositions[nextHistoryPosBase + 2] = previousHistoryPositions[previousHistoryPosBase + 2];
        historySpeeds[nextHistorySlot] = previousHistorySpeeds[previousHistorySlot];
      }

      sampleCounts[nextIndex] = samplesToCopy;
      writeIndices[nextIndex] = samplesToCopy % activeHistoryPoints;
    }

    lastSeenFrame = previousLastSeenFrame;
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
      gradeTrailColor(liveT, tmpColor);

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

        const speed = historySpeeds[historySlot];
        const t = invSpeedSpan > 0 ? clamp01((speed - speedMin) * invSpeedSpan) : 0;
        gradeTrailColor(t, tmpColor);

        const gradient = sampleCount > 1 ? point / (sampleCount - 1) : 1;
        const alpha = tailAlpha + (headAlpha - tailAlpha) * gradient;

        renderColors[colorOffset++] = tmpColor.r;
        renderColors[colorOffset++] = tmpColor.g;
        renderColors[colorOffset++] = tmpColor.b;
        renderColors[colorOffset++] = alpha;
        renderPointCount += 1;
      }

      if (sampledPointsToRender > 0) {
        renderPositions[posOffset++] = liveX;
        renderPositions[posOffset++] = liveY;
        renderPositions[posOffset++] = liveZ;
        renderColors[colorOffset++] = tmpColor.r;
        renderColors[colorOffset++] = tmpColor.g;
        renderColors[colorOffset++] = tmpColor.b;
        renderColors[colorOffset++] = headAlpha;
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

    if (count < activeBodyCount && trailMesh) {
      migrateForReducedBodyCount(count, positions);
    } else if (count !== activeBodyCount || !trailMesh || detailChanged) {
      allocateForBodies(count, nextDetail.historyPoints, nextDetail.sampleStride);
    }

    if (frame <= lastSeenFrame) {
      resetHistory();
    }
    lastSeenFrame = frame;

    if (!trailMesh) {
      return;
    }

    if (frame % activeSampleStride !== 0) {
      const hasRenderableSegments = rebuildRenderData(speedMin, speedSpan, positions, speeds);
      trailMesh.updateVerticesData(VertexBuffer.PositionKind, renderPositions, false, false);
      trailMesh.updateVerticesData(VertexBuffer.ColorKind, renderColors, false, false);
      trailMesh.setEnabled(hasRenderableSegments);
      recordLivePositions(positions, count);
      return;
    }

    appendSamples(positions, speeds);
    const hasRenderableSegments = rebuildRenderData(speedMin, speedSpan, positions, speeds);

    trailMesh.updateVerticesData(VertexBuffer.PositionKind, renderPositions, false, false);
    trailMesh.updateVerticesData(VertexBuffer.ColorKind, renderColors, false, false);
    trailMesh.setEnabled(hasRenderableSegments);
    recordLivePositions(positions, count);
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
