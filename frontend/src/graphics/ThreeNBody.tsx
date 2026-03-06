import React, { useEffect, useRef } from 'react';
import {
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Scene,
  UniversalCamera,
  Vector3
} from '@babylonjs/core';
import {
  BILLBOARD_SWITCH_DISTANCE,
  BODY_SPHERE_RADIUS,
  VECTOR_OVERLAY_SCALE_RADIUS
} from '../lib/config';
import { useFrameStore } from '../state/useFrameStore';
import { createBodyInstancesRenderer } from './threeNBody/bodyInstances';
import { createCameraRig } from './threeNBody/cameraRig';
import { computeBounds, percentileRange } from './threeNBody/math';
import { createVectorOverlayManager } from './threeNBody/vectorOverlays';

export function ThreeNBody() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

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
    engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
    const preventContextMenu = (ev: Event) => ev.preventDefault();
    canvas.addEventListener('contextmenu', preventContextMenu);

    const scene = new Scene(engine);
    scene.clearColor = new Color4(5 / 255, 6 / 255, 10 / 255, 1);

    const camera = new UniversalCamera('camera', new Vector3(0, 0, 3), scene);
    camera.fov = Math.PI / 2.5;
    camera.minZ = 0.01;
    camera.maxZ = 10000;
    camera.inputs.clear();
    camera.upVector = Vector3.Up();

    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.35;
    const dir = new DirectionalLight('dir', new Vector3(-2, -2, -2).normalize(), scene);
    dir.position = new Vector3(2, 2, 2);
    dir.intensity = 1.1;

    const bodyInstances = createBodyInstancesRenderer(scene);
    const vectorOverlays = createVectorOverlayManager(scene);

    let bodyRadius = BODY_SPHERE_RADIUS;
    let lastFrame = -1;
    let lastBodyCount = 0;
    let lastTime = performance.now();
    let boundsCenter = new Vector3(0, 0, 0);
    let boundsRadius = 1;
    let needsFit = true;
    let speedScratch = new Float32Array(0);
    let accelerationVectorScratch = new Float32Array(0);
    let accelerationMagnitudeScratch = new Float32Array(0);
    let previousVelocitySnapshot = new Float32Array(0);
    let previousFrameSampleTime = 0;
    let previousVelocityVectorsVisible = false;
    let previousAccelerationVectorsVisible = false;
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
      getInvertLook: () => useFrameStore.getState().invertLook,
      getBaseMoveSpeed: () => useFrameStore.getState().cameraBaseMoveSpeed
    });

    const onResize = () => {
      engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
      engine.resize();
    };

    window.addEventListener('resize', onResize);

    const renderLoop = () => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const state = useFrameStore.getState();
      const {
        positions,
        velocities,
        frame,
        bodyCount,
        showVelocityVectors,
        showAccelerationVectors,
        lastFrameTime
      } = state;

      if (positions && velocities && frame !== lastFrame) {
        lastFrame = frame;
        const bodyCountChanged = bodyCount !== lastBodyCount;

        if (bodyCountChanged) {
          needsFit = true;
          lastBodyCount = bodyCount;
        }

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

        for (let i = 0; i < bodyCount; i++) {
          const base = i * 3;
          const vx = velocities[base];
          const vy = velocities[base + 1];
          const vz = velocities[base + 2];
          speedScratch[i] = Math.sqrt(vx * vx + vy * vy + vz * vz);
        }

        const [speedMin, speedMax] = percentileRange(speedScratch, bodyCount, 0.05, 0.95);
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

        const [accMin, accMax] = percentileRange(accelerationMagnitudeScratch, bodyCount, 0.05, 0.95);
        const accSpan = Math.max(accMax - accMin, 1e-6);

        bodyRadius = BODY_SPHERE_RADIUS;
        bodyInstances.setBodyRadius(bodyRadius);
        bodyInstances.update(
          positions,
          speedScratch,
          bodyCount,
          speedMin,
          speedSpan,
          camera.position,
          BILLBOARD_SWITCH_DISTANCE * BILLBOARD_SWITCH_DISTANCE
        );
        latestPositions = positions;
        latestVelocities = velocities;
        latestAccelerationVectors = accelerationVectorScratch;
        latestAccelerationMagnitudes = accelerationMagnitudeScratch;
        latestSpeedMin = speedMin;
        latestSpeedSpan = speedSpan;
        latestAccelerationMin = accMin;
        latestAccelerationSpan = accSpan;
        lastBodyUpdateCameraPos.copyFrom(camera.position);

        if (showVelocityVectors) {
          vectorOverlays.update('velocity', positions, velocities, speedScratch, bodyCount, speedMin, speedSpan, vectorScaleRadius);
        }
        if (showAccelerationVectors) {
          vectorOverlays.update(
            'acceleration',
            positions,
            accelerationVectorScratch,
            accelerationMagnitudeScratch,
            bodyCount,
            accMin,
            accSpan,
            vectorScaleRadius
          );
        }

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

      if (showVelocityVectors !== previousVelocityVectorsVisible) {
        if (showVelocityVectors) {
          if (latestPositions && latestVelocities && speedScratch.length === lastBodyCount && lastBodyCount > 0) {
            vectorOverlays.update(
              'velocity',
              latestPositions,
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
            latestPositions
            && latestAccelerationVectors
            && latestAccelerationMagnitudes
            && lastBodyCount > 0
          ) {
            vectorOverlays.update(
              'acceleration',
              latestPositions,
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

      cameraRig.update(dt);

      // Refresh body classification only when camera moved and we have cached frame data.
      if (latestPositions && speedScratch.length === lastBodyCount && lastBodyCount > 0) {
        const camDx = camera.position.x - lastBodyUpdateCameraPos.x;
        const camDy = camera.position.y - lastBodyUpdateCameraPos.y;
        const camDz = camera.position.z - lastBodyUpdateCameraPos.z;
        const cameraMovedSq = camDx * camDx + camDy * camDy + camDz * camDz;
        if (cameraMovedSq > 1e-6) {
          bodyInstances.update(
            latestPositions,
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
      vectorOverlays.dispose();
      scene.dispose();
      engine.dispose();
      if (host.contains(canvas)) host.removeChild(canvas);
    };
  }, []);

  return <div ref={hostRef} className="canvas-host" />;
}
