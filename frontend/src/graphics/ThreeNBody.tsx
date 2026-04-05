import React, { useEffect, useRef } from 'react';
import {
  Constants,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  Engine,
  GlowLayer,
  HemisphericLight,
  Scene,
  UniversalCamera,
  Vector3
} from '@babylonjs/core';
import {
  DESKTOP_BILLBOARD_SWITCH_DISTANCE,
  MOBILE_BILLBOARD_SWITCH_DISTANCE,
  BODY_SPHERE_RADIUS,
  VECTOR_OVERLAY_SCALE_RADIUS
} from '../lib/config';
import { useFrameStore } from '../state/useFrameStore';
import {
  createBodyInstancesRenderer,
  type BodyRenderTheme
} from './threeNBody/bodyInstances';
import { createCameraRig } from './threeNBody/cameraRig';
import { computeBounds, percentileRange } from './threeNBody/math';
import { createOrbitTrailManager } from './threeNBody/orbitTrails';
import { createVectorOverlayManager } from './threeNBody/vectorOverlays';
import { createWorldGridRenderer } from './threeNBody/worldGrid';

type ThreeNBodyProps = {
  virtualMoveX?: number;
  virtualMoveY?: number;
  renderTheme?: BodyRenderTheme;
};

const MIN_BODY_INTERPOLATION_MS = 16;
const MAX_BODY_INTERPOLATION_MS = 400;

export const ThreeNBody = React.memo(function ThreeNBody({
  virtualMoveX = 0,
  virtualMoveY = 0,
  renderTheme = 'default'
}: ThreeNBodyProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const virtualMoveRef = useRef({ x: virtualMoveX, y: virtualMoveY });

  virtualMoveRef.current.x = virtualMoveX;
  virtualMoveRef.current.y = virtualMoveY;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const useStableOrbitTheme = renderTheme === 'stable-orbits';
    const maxRenderPixelRatio = useStableOrbitTheme ? 2 : 1.5;
    const stableColorSeed = Math.floor(Math.random() * 1_000_000_000);

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    host.appendChild(canvas);

    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, maxRenderPixelRatio));
    const preventContextMenu = (ev: Event) => ev.preventDefault();
    canvas.addEventListener('contextmenu', preventContextMenu);

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 1);

    const camera = new UniversalCamera('camera', new Vector3(0, 0, 3), scene);
    camera.fov = Math.PI / 2.5;
    camera.minZ = 0.01;
    camera.maxZ = 10000;
    camera.inputs.clear();
    camera.upVector = Vector3.Up();

    // Dynamic bloom: blur the live scene each frame using a downsampled pass 
    const renderingPipeline = new DefaultRenderingPipeline(
      'nBodyRenderingPipeline',
      true,
      scene,
      [camera]
    );
    renderingPipeline.bloomEnabled = true;
    renderingPipeline.bloomThreshold = useStableOrbitTheme ? 0.08 : 0;
    renderingPipeline.bloomKernel = useStableOrbitTheme ? 60 : 220;
    renderingPipeline.bloomWeight = useStableOrbitTheme ? 0.12 : 0.01;
    renderingPipeline.bloomScale = useStableOrbitTheme ? 0.9 : 0.5;
    renderingPipeline.samples = useStableOrbitTheme
      ? Math.max(1, Math.min(8, engine.getCaps().maxMSAASamples || 1))
      : Math.max(1, Math.min(4, engine.getCaps().maxMSAASamples || 1));

    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = useStableOrbitTheme ? 0.08 : 0.35;
    const dir = new DirectionalLight('dir', new Vector3(-2, -2, -2).normalize(), scene);
    dir.position = new Vector3(2, 2, 2);
    dir.intensity = useStableOrbitTheme ? 0.18 : 1.1;

    const bodyInstances = createBodyInstancesRenderer(scene, renderTheme, stableColorSeed);
    const vectorOverlays = createVectorOverlayManager(scene, renderTheme, stableColorSeed);
    let wideGlowLayer: GlowLayer | null = null;
    renderingPipeline.glowLayerEnabled = useStableOrbitTheme;
    if (useStableOrbitTheme && renderingPipeline.glowLayer) {
      const glowLayer = renderingPipeline.glowLayer;
      const velocityVectorMesh = vectorOverlays.getMesh('velocity');
      const accelerationVectorMesh = vectorOverlays.getMesh('acceleration');
      glowLayer.blurKernelSize = 16;
      glowLayer.intensity = 0.72;
      glowLayer.setExcludedByDefault(true);
      glowLayer.addIncludedOnlyMesh(bodyInstances.mesh);
      glowLayer.addIncludedOnlyMesh(bodyInstances.pointMesh);
      glowLayer.addIncludedOnlyMesh(velocityVectorMesh);
      glowLayer.addIncludedOnlyMesh(accelerationVectorMesh);
      glowLayer.referenceMeshToUseItsOwnMaterial(bodyInstances.mesh);
      glowLayer.referenceMeshToUseItsOwnMaterial(bodyInstances.pointMesh);
      glowLayer.referenceMeshToUseItsOwnMaterial(velocityVectorMesh);
      glowLayer.referenceMeshToUseItsOwnMaterial(accelerationVectorMesh);

      // Second large-radius glow pass to create a broad halo around bright bodies.
      wideGlowLayer = new GlowLayer('nbody-wide-glow', scene, {
        mainTextureRatio: 0.25,
        alphaBlendingMode: Constants.ALPHA_SCREENMODE,
        camera,
      });
      wideGlowLayer.blurKernelSize = 132;
      wideGlowLayer.intensity = 0.22;
      wideGlowLayer.setExcludedByDefault(true);
      wideGlowLayer.addIncludedOnlyMesh(bodyInstances.mesh);
      wideGlowLayer.addIncludedOnlyMesh(bodyInstances.pointMesh);
      wideGlowLayer.addIncludedOnlyMesh(velocityVectorMesh);
      wideGlowLayer.addIncludedOnlyMesh(accelerationVectorMesh);
      wideGlowLayer.referenceMeshToUseItsOwnMaterial(bodyInstances.mesh);
      wideGlowLayer.referenceMeshToUseItsOwnMaterial(bodyInstances.pointMesh);
      wideGlowLayer.referenceMeshToUseItsOwnMaterial(velocityVectorMesh);
      wideGlowLayer.referenceMeshToUseItsOwnMaterial(accelerationVectorMesh);
    }

    const orbitTrails = createOrbitTrailManager(scene, renderTheme, stableColorSeed);
    const worldGrid = createWorldGridRenderer(scene);
    worldGrid.setVisible(useFrameStore.getState().showWorldGrid);

    let bodyRadius = BODY_SPHERE_RADIUS;
    let lastFrame = -1;
    let lastBodyCount = 0;
    let lastTime = performance.now();
    let displayPositions = new Float32Array(0);
    let blendStartPositions = new Float32Array(0);
    let blendTargetPositions = new Float32Array(0);
    let blendStartTime = 0;
    let blendDurationMs = 0;
    let blendActive = false;
    let boundsCenter = new Vector3(0, 0, 0);
    let boundsRadius = 1;
    let needsFit = true;
    let speedScratch = new Float32Array(0);
    let accelerationVectorScratch = new Float32Array(0);
    let accelerationMagnitudeScratch = new Float32Array(0);
    let percentileScratch = new Float32Array(0);
    let previousVelocitySnapshot = new Float32Array(0);
    let previousFrameSampleTime = 0;
    let previousVelocityVectorsVisible = false;
    let previousAccelerationVectorsVisible = false;
    let previousOrbitTrailsVisible = useFrameStore.getState().showOrbitTrails;
    let previousWorldGridVisible = useFrameStore.getState().showWorldGrid;
    let latestPositions: Float32Array | null = null;
    let latestVelocities: Float32Array | null = null;
    let latestAccelerationVectors: Float32Array | null = null;
    let latestAccelerationMagnitudes: Float32Array | null = null;
    let latestSpeedMin = 0;
    let latestSpeedSpan = 1;
    let latestAccelerationMin = 0;
    let latestAccelerationSpan = 1;
    const vectorScaleRadius = VECTOR_OVERLAY_SCALE_RADIUS;
    const lastBodyUpdateCameraPos = new Vector3(Number.NaN, Number.NaN, Number.NaN);

    const cameraRig = createCameraRig({
      canvas,
      camera,
      getBoundsCenter: () => boundsCenter,
      getBoundsRadius: () => boundsRadius,
      getVirtualMoveAxes: () => virtualMoveRef.current,
      getInvertLook: () => useFrameStore.getState().invertLook,
      getBaseMoveSpeed: () => useFrameStore.getState().cameraBaseMoveSpeed,
      setBaseMoveSpeed: (speed) => useFrameStore.getState().setCameraBaseMoveSpeed(speed)
    });

    function isMobileDevice(): boolean {
      if (typeof window === 'undefined') return false;
      try {
        return (
          'ontouchstart' in window ||
          (navigator as any).maxTouchPoints > 0 ||
          (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
          window.innerWidth <= 768
        );
      } catch {
        return false;
      }
    }
    const BILLBOARD_SWITCH_DISTANCE = isMobileDevice()
      ? MOBILE_BILLBOARD_SWITCH_DISTANCE
      : DESKTOP_BILLBOARD_SWITCH_DISTANCE;

    const onResize = () => {
      engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, maxRenderPixelRatio));
      engine.resize();
    };

    window.addEventListener('resize', onResize);

    const ensureDisplayBuffers = (floatCount: number) => {
      if (displayPositions.length !== floatCount) {
        displayPositions = new Float32Array(floatCount);
        blendStartPositions = new Float32Array(floatCount);
        blendTargetPositions = new Float32Array(floatCount);
        blendActive = false;
      }
    };

    const snapDisplayPositions = (positions: Float32Array) => {
      ensureDisplayBuffers(positions.length);
      displayPositions.set(positions);
      blendStartPositions.set(positions);
      blendTargetPositions.set(positions);
      blendStartTime = 0;
      blendDurationMs = 0;
      blendActive = false;
    };

    const beginDisplayInterpolation = (
      positions: Float32Array,
      durationMs: number,
      nowMs: number
    ) => {
      ensureDisplayBuffers(positions.length);
      blendStartPositions.set(displayPositions);
      blendTargetPositions.set(positions);
      blendStartTime = nowMs;
      blendDurationMs = Math.min(
        MAX_BODY_INTERPOLATION_MS,
        Math.max(MIN_BODY_INTERPOLATION_MS, durationMs)
      );
      blendActive = true;
    };

    const updateDisplayPositions = (nowMs: number) => {
      if (displayPositions.length === 0 || !blendActive || blendDurationMs <= 0) {
        return false;
      }

      const rawProgress = Math.min(1, Math.max(0, (nowMs - blendStartTime) / blendDurationMs));
      const easedProgress = rawProgress * rawProgress * (3 - 2 * rawProgress);
      const inverseProgress = 1 - easedProgress;

      for (let i = 0; i < displayPositions.length; i++) {
        displayPositions[i] =
          blendStartPositions[i] * inverseProgress + blendTargetPositions[i] * easedProgress;
      }

      if (rawProgress >= 1) {
        displayPositions.set(blendTargetPositions);
        blendActive = false;
      }

      return true;
    };

    const renderLoop = () => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      let frameChanged = false;
      // Advance any active interpolation before processing newly arrived samples.
      const displayPositionsChanged = updateDisplayPositions(now);

      const state = useFrameStore.getState();
      const {
        positions,
        velocities,
        frame,
        bodyCount,
        showVelocityVectors,
        showAccelerationVectors,
        showOrbitTrails,
        showWorldGrid,
        lastFrameTime
      } = state;

      const hasFreshFrameSample =
        frame !== lastFrame || lastFrameTime > previousFrameSampleTime;

      if (positions && velocities && hasFreshFrameSample) {
        frameChanged = true;
        const isResetOrRewind = frame < lastFrame;
        const frameIntervalMs =
          previousFrameSampleTime > 0 && lastFrameTime > previousFrameSampleTime
            ? lastFrameTime - previousFrameSampleTime
            : 1000 / 60;
        const shouldSnapDisplay =
          isResetOrRewind
          || displayPositions.length !== positions.length
          || lastBodyCount !== bodyCount
          || lastFrame < 0;

        if (shouldSnapDisplay) {
          snapDisplayPositions(positions);
        } else {
          beginDisplayInterpolation(positions, frameIntervalMs, now);
        }

        if (frame < lastFrame) {
          previousVelocitySnapshot = new Float32Array(0);
          previousFrameSampleTime = 0;
        }

        lastFrame = frame;
        if (lastBodyCount === 0 && bodyCount > 0) {
          needsFit = true;
        }
        lastBodyCount = bodyCount;

        boundsRadius = computeBounds(positions, bodyCount, boundsCenter);
        if (speedScratch.length !== bodyCount) {
          speedScratch = new Float32Array(bodyCount);
        }
        if (accelerationVectorScratch.length !== bodyCount * 3) {
          accelerationVectorScratch = new Float32Array(bodyCount * 3);
        }
        if (accelerationMagnitudeScratch.length !== bodyCount) {
          accelerationMagnitudeScratch = new Float32Array(bodyCount);
        }
        if (percentileScratch.length !== bodyCount) {
          percentileScratch = new Float32Array(bodyCount);
        }

        for (let i = 0; i < bodyCount; i++) {
          const base = i * 3;
          const vx = velocities[base];
          const vy = velocities[base + 1];
          const vz = velocities[base + 2];
          speedScratch[i] = Math.sqrt(vx * vx + vy * vy + vz * vz);
        }

        const [speedMin, speedMax] = percentileRange(
          speedScratch,
          bodyCount,
          0.05,
          0.95,
          percentileScratch
        );
        const speedSpan = Math.max(speedMax - speedMin, 1e-6);

        const hasPrevious =
          previousVelocitySnapshot.length === velocities.length
          && previousFrameSampleTime > 0
          && lastFrameTime > previousFrameSampleTime;
        const deltaTimeSec = hasPrevious ? (lastFrameTime - previousFrameSampleTime) / 1000 : 0;
        const invDeltaTime = deltaTimeSec > 1e-6 ? 1 / deltaTimeSec : 0;

        if (hasPrevious && invDeltaTime > 0) {
          for (let i = 0; i < bodyCount; i++) {
            const base = i * 3;
            const ax = (velocities[base] - previousVelocitySnapshot[base]) * invDeltaTime;
            const ay = (velocities[base + 1] - previousVelocitySnapshot[base + 1]) * invDeltaTime;
            const az = (velocities[base + 2] - previousVelocitySnapshot[base + 2]) * invDeltaTime;
            accelerationVectorScratch[base] = ax;
            accelerationVectorScratch[base + 1] = ay;
            accelerationVectorScratch[base + 2] = az;
            accelerationMagnitudeScratch[i] = Math.sqrt(ax * ax + ay * ay + az * az);
          }
        } else {
          accelerationVectorScratch.fill(0);
          accelerationMagnitudeScratch.fill(0);
        }

        const [accMin, accMax] = percentileRange(
          accelerationMagnitudeScratch,
          bodyCount,
          0.05,
          0.95,
          percentileScratch
        );
        const accSpan = Math.max(accMax - accMin, 1e-6);

        bodyRadius = BODY_SPHERE_RADIUS;
        bodyInstances.setBodyRadius(bodyRadius);
        latestPositions = positions;
        latestVelocities = velocities;
        latestAccelerationVectors = accelerationVectorScratch;
        latestAccelerationMagnitudes = accelerationMagnitudeScratch;
        latestSpeedMin = speedMin;
        latestSpeedSpan = speedSpan;
        latestAccelerationMin = accMin;
        latestAccelerationSpan = accSpan;
        lastBodyUpdateCameraPos.copyFrom(camera.position);

        if (previousVelocitySnapshot.length !== velocities.length) {
          previousVelocitySnapshot = new Float32Array(velocities.length);
        }
        previousVelocitySnapshot.set(velocities);
        previousFrameSampleTime = lastFrameTime;

        if (needsFit) {
          cameraRig.fitToBounds();
          needsFit = false;
        }
      }

      const anchorPositions =
        displayPositions.length === lastBodyCount * 3
          ? displayPositions
          : latestPositions;

      if (showVelocityVectors !== previousVelocityVectorsVisible) {
        if (showVelocityVectors) {
          if (
            anchorPositions
            && latestVelocities
            && speedScratch.length === lastBodyCount
            && lastBodyCount > 0
          ) {
            vectorOverlays.update(
              'velocity',
              anchorPositions,
              latestVelocities,
              speedScratch,
              lastBodyCount,
              latestSpeedMin,
              latestSpeedSpan,
              vectorScaleRadius
            );
          }
        } else {
          vectorOverlays.clear('velocity');
        }
      }
      previousVelocityVectorsVisible = showVelocityVectors;

      if (showAccelerationVectors !== previousAccelerationVectorsVisible) {
        if (showAccelerationVectors) {
          if (
            anchorPositions
            && latestAccelerationVectors
            && latestAccelerationMagnitudes
            && lastBodyCount > 0
          ) {
            vectorOverlays.update(
              'acceleration',
              anchorPositions,
              latestAccelerationVectors,
              latestAccelerationMagnitudes,
              lastBodyCount,
              latestAccelerationMin,
              latestAccelerationSpan,
              vectorScaleRadius
            );
          }
        } else {
          vectorOverlays.clear('acceleration');
        }
      }
      previousAccelerationVectorsVisible = showAccelerationVectors;

      const orbitTrailsVisibilityChanged = showOrbitTrails !== previousOrbitTrailsVisible;
      if (orbitTrailsVisibilityChanged) {
        if (!showOrbitTrails) {
          orbitTrails.clear();
        }
      }

      if (
        showOrbitTrails
        && anchorPositions
        && speedScratch.length === lastBodyCount
        && lastBodyCount > 0
        && (frameChanged || displayPositionsChanged || orbitTrailsVisibilityChanged)
      ) {
        orbitTrails.update(
          frame,
          anchorPositions,
          speedScratch,
          lastBodyCount,
          latestSpeedMin,
          latestSpeedSpan
        );
      }
      previousOrbitTrailsVisible = showOrbitTrails;

      if (showWorldGrid !== previousWorldGridVisible) {
        worldGrid.setVisible(showWorldGrid);
      }
      previousWorldGridVisible = showWorldGrid;

      if (frameChanged || displayPositionsChanged) {
        if (
          showVelocityVectors
          && anchorPositions
          && latestVelocities
          && speedScratch.length === lastBodyCount
          && lastBodyCount > 0
        ) {
          vectorOverlays.update(
            'velocity',
            anchorPositions,
            latestVelocities,
            speedScratch,
            lastBodyCount,
            latestSpeedMin,
            latestSpeedSpan,
            vectorScaleRadius
          );
        }

        if (
          showAccelerationVectors
          && anchorPositions
          && latestAccelerationVectors
          && latestAccelerationMagnitudes
          && lastBodyCount > 0
        ) {
          vectorOverlays.update(
            'acceleration',
            anchorPositions,
            latestAccelerationVectors,
            latestAccelerationMagnitudes,
            lastBodyCount,
            latestAccelerationMin,
            latestAccelerationSpan,
            vectorScaleRadius
          );
        }
      }

      cameraRig.update(dt);
      if (showWorldGrid) {
        worldGrid.update(camera.position);
      }

      // Refresh rendered positions when interpolating, after a new frame, or when camera distance bands change.
      if (displayPositions.length > 0 && speedScratch.length === lastBodyCount && lastBodyCount > 0) {
        const camDx = camera.position.x - lastBodyUpdateCameraPos.x;
        const camDy = camera.position.y - lastBodyUpdateCameraPos.y;
        const camDz = camera.position.z - lastBodyUpdateCameraPos.z;
        const cameraMovedSq = camDx * camDx + camDy * camDy + camDz * camDz;
        if (frameChanged || displayPositionsChanged || cameraMovedSq > 1e-6) {
          bodyInstances.update(
            displayPositions,
            speedScratch,
            lastBodyCount,
            latestSpeedMin,
            latestSpeedSpan,
            camera.position,
            BILLBOARD_SWITCH_DISTANCE * BILLBOARD_SWITCH_DISTANCE
          );
          lastBodyUpdateCameraPos.copyFrom(camera.position);
        }
      }

      if (lastBodyCount > 0) {
        const distanceToCenter = Vector3.Distance(camera.position, boundsCenter);
        const cloudRadius = Math.max(boundsRadius, bodyRadius * 2);
        const closestBodyDistance = Math.max(distanceToCenter - cloudRadius, 0);
        const nextMinZ = Math.max(0.01, Math.min(5, closestBodyDistance * 0.2));
        const nextMaxZ = Math.max(10000, distanceToCenter + cloudRadius * 3 + 100);
        camera.minZ = nextMinZ;
        camera.maxZ = nextMaxZ;
      }

      scene.render();
    };

    engine.runRenderLoop(renderLoop);

    return () => {
      engine.stopRenderLoop(renderLoop);
      window.removeEventListener('resize', onResize);
      cameraRig.dispose();
      canvas.removeEventListener('contextmenu', preventContextMenu);
      bodyInstances.dispose();
      orbitTrails.dispose();
      worldGrid.dispose();
      vectorOverlays.dispose();
      wideGlowLayer?.dispose();
      renderingPipeline.dispose();
      scene.dispose();
      engine.dispose();
      if (host.contains(canvas)) host.removeChild(canvas);
    };
  }, []);

  return <div ref={hostRef} className="canvas-host" />;
});
