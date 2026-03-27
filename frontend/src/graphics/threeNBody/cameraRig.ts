import { Matrix, Quaternion, UniversalCamera, Vector3 } from '@babylonjs/core';

export const CAMERA_SPEED_MIN = 10;
export const CAMERA_SPEED_MAX = 1_000_000;

const CAMERA_SPEED_LOG_MIN = Math.log10(CAMERA_SPEED_MIN);
const CAMERA_SPEED_LOG_MAX = Math.log10(CAMERA_SPEED_MAX);
const CAMERA_SPEED_WHEEL_SLIDER_STEP = 0.02;

export function speedToLogSliderValue(speed: number): number {
  const clamped = Math.max(CAMERA_SPEED_MIN, Math.min(CAMERA_SPEED_MAX, speed));
  const normalized =
    (Math.log10(clamped) - CAMERA_SPEED_LOG_MIN) / (CAMERA_SPEED_LOG_MAX - CAMERA_SPEED_LOG_MIN);
  return Math.max(0, Math.min(1, normalized));
}

export function logSliderValueToSpeed(sliderValue: number): number {
  const normalized = Math.max(0, Math.min(1, sliderValue));
  const exponent = CAMERA_SPEED_LOG_MIN + normalized * (CAMERA_SPEED_LOG_MAX - CAMERA_SPEED_LOG_MIN);
  return Math.round(Math.pow(10, exponent));
}

export function wheelDeltaToCameraSpeed(currentSpeed: number, deltaY: number): number {
  if (deltaY === 0) {
    return currentSpeed;
  }

  const sliderValue = speedToLogSliderValue(currentSpeed);
  const direction = deltaY < 0 ? 1 : -1;
  const nextSliderValue = Math.max(
    0,
    Math.min(1, sliderValue + direction * CAMERA_SPEED_WHEEL_SLIDER_STEP)
  );
  return logSliderValueToSpeed(nextSliderValue);
}

type CameraRigOptions = {
  canvas: HTMLCanvasElement;
  camera: UniversalCamera;
  getBoundsCenter: () => Vector3;
  getBoundsRadius: () => number;
  getVirtualMoveAxes: () => { x: number; y: number };
  getInvertLook: () => boolean;
  getBaseMoveSpeed: () => number;
  setBaseMoveSpeed: (speed: number) => void;
};

export type CameraRig = {
  fitToBounds: () => void;
  requestRecenter: () => void;
  update: (dt: number) => void;
  dispose: () => void;
};

export function createCameraRig(options: CameraRigOptions): CameraRig {
  const {
    canvas,
    camera,
    getBoundsCenter,
    getBoundsRadius,
    getVirtualMoveAxes,
    getInvertLook,
    getBaseMoveSpeed,
    setBaseMoveSpeed
  } = options;

  let orientation = Quaternion.FromEulerAngles(0, Math.PI, 0);
  let camPos = new Vector3(0, 0, 3);
  let minDistance = 0.1;
  let maxDistance = 1000;

  let isDragging = false;
  let dragButton: number | null = null;
  const lastPointer = { x: 0, y: 0 };
  const touchPointers = new Map<number, { x: number; y: number }>();
  let touchMode: 'none' | 'single' | 'multi' = 'none';
  let lastTouchCenter = { x: 0, y: 0 };
  let lastTouchDistance = 0;
  let lastTouchAngle = 0;
  const keys: Record<string, boolean> = {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    AltLeft: false,
    AltRight: false,
    ControlLeft: false,
    ControlRight: false,
    ShiftLeft: false,
    ShiftRight: false
  };
  let recenterRequested = false;

  const forwardDir = new Vector3();
  const rightDir = new Vector3();
  const upDir = new Vector3();
  const moveDelta = new Vector3();
  const tmpOffset = new Vector3();
  const tmpScaled = new Vector3();
  const rotMat = Matrix.Identity();
  const worldForward = new Vector3(0, 0, 1);
  const worldRight = new Vector3(1, 0, 0);
  const worldUp = new Vector3(0, 1, 0);

  const normalizeAngleDelta = (delta: number) => {
    if (delta > Math.PI) {
      return delta - Math.PI * 2;
    }
    if (delta < -Math.PI) {
      return delta + Math.PI * 2;
    }
    return delta;
  };

  const updateOrientationVectors = () => {
    orientation.normalize();
    orientation.toRotationMatrix(rotMat);
    Vector3.TransformNormalToRef(worldForward, rotMat, forwardDir);
    forwardDir.normalize();
    Vector3.TransformNormalToRef(worldRight, rotMat, rightDir);
    rightDir.normalize();
    Vector3.TransformNormalToRef(worldUp, rotMat, upDir);
    upDir.normalize();
  };

  const applyCameraTransform = () => {
    updateOrientationVectors();
    camera.position.copyFrom(camPos);
    camera.rotationQuaternion = orientation;
    camera.upVector.copyFrom(upDir);
  };

  const fitToBounds = () => {
    const boundsCenter = getBoundsCenter();
    const boundsRadius = getBoundsRadius();
    const distance = (boundsRadius / Math.tan(camera.fov * 0.5)) * 1.2;
    const fitDistance = Number.isFinite(distance) && distance > 0 ? distance : 3;
    // Keep zoom-in usable even when the cloud radius grows over long runs.
    minDistance = Math.max(Math.min(boundsRadius * 0.02, 12), 0.05);
    maxDistance = Math.max(boundsRadius * 10, fitDistance * 4);
    const clamped = Math.min(Math.max(fitDistance, minDistance), maxDistance);

    orientation = Quaternion.FromEulerAngles(0, Math.PI, 0);
    camPos.set(boundsCenter.x, boundsCenter.y, boundsCenter.z + clamped);
    applyCameraTransform();
  };

  const clampDistanceFromBoundsCenter = () => {
    const boundsCenter = getBoundsCenter();
    tmpOffset.copyFrom(camPos).subtractInPlace(boundsCenter);
    const distance = tmpOffset.length();
    const clampedDistance = Math.max(minDistance, Math.min(maxDistance, distance));

    if (!Number.isFinite(distance) || distance < 1e-6) {
      tmpScaled.copyFrom(forwardDir).scaleInPlace(clampedDistance);
      camPos.copyFrom(boundsCenter).subtractInPlace(tmpScaled);
      return;
    }

    if (Math.abs(clampedDistance - distance) > 1e-6) {
      tmpScaled.copyFrom(tmpOffset).scaleInPlace(clampedDistance / distance);
      camPos.copyFrom(boundsCenter).addInPlace(tmpScaled);
    }
  };

  const applyTouchOrbit = (dx: number, dy: number) => {
    const sensitivity = 0.003;
    updateOrientationVectors();
    const invert = getInvertLook();
    const yawDelta = dx * sensitivity * (invert ? -1 : 1);
    const pitchDelta = dy * sensitivity * (invert ? -1 : 1);
    const yawRotation = Quaternion.RotationAxis(upDir, yawDelta);
    const pitchRotation = Quaternion.RotationAxis(rightDir, pitchDelta);
    orientation = pitchRotation.multiply(yawRotation).multiply(orientation);
    orientation.normalize();
  };

  const applyTouchPan = (dx: number, dy: number) => {
    const panSensitivity = 0.4;
    updateOrientationVectors();
    tmpScaled.copyFrom(rightDir).scaleInPlace(-dx * panSensitivity);
    camPos.addInPlace(tmpScaled);
    tmpScaled.copyFrom(upDir).scaleInPlace(dy * panSensitivity);
    camPos.addInPlace(tmpScaled);
  };

  const applyTouchRoll = (angleDelta: number) => {
    updateOrientationVectors();
    const rollRotation = Quaternion.RotationAxis(forwardDir, angleDelta);
    orientation = rollRotation.multiply(orientation);
    orientation.normalize();
  };

  const applyTouchZoom = (distanceDelta: number) => {
    updateOrientationVectors();
    const distanceToCenter = Vector3.Distance(camPos, getBoundsCenter());
    const zoomSensitivity = Math.max(distanceToCenter * 0.01, minDistance * 0.5, 0.02);
    tmpScaled.copyFrom(forwardDir).scaleInPlace(distanceDelta * zoomSensitivity);
    camPos.addInPlace(tmpScaled);
    clampDistanceFromBoundsCenter();
  };

  const resetTouchGestureReference = () => {
    const points = [...touchPointers.values()];
    if (points.length === 0) {
      touchMode = 'none';
      return;
    }

    if (points.length === 1) {
      touchMode = 'single';
      lastPointer.x = points[0].x;
      lastPointer.y = points[0].y;
      return;
    }

    const [p1, p2] = points;
    touchMode = 'multi';
    lastTouchCenter = {
      x: (p1.x + p2.x) * 0.5,
      y: (p1.y + p2.y) * 0.5
    };
    lastTouchDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    lastTouchAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  };

  const onPointerDown = (ev: PointerEvent) => {
    if (ev.pointerType === 'touch') {
      touchPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      canvas.setPointerCapture(ev.pointerId);
      resetTouchGestureReference();
      return;
    }

    isDragging = true;
    dragButton = ev.button;
    lastPointer.x = ev.clientX;
    lastPointer.y = ev.clientY;
    canvas.setPointerCapture(ev.pointerId);
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (ev.pointerType === 'touch') {
      if (!touchPointers.has(ev.pointerId)) {
        return;
      }

      touchPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const points = [...touchPointers.values()];
      if (points.length === 1) {
        const point = points[0];
        if (touchMode !== 'single') {
          resetTouchGestureReference();
          return;
        }
        const dx = point.x - lastPointer.x;
        const dy = point.y - lastPointer.y;
        applyTouchOrbit(dx, dy);
        lastPointer.x = point.x;
        lastPointer.y = point.y;
        return;
      }

      if (points.length >= 2) {
        const [p1, p2] = points;
        const centerX = (p1.x + p2.x) * 0.5;
        const centerY = (p1.y + p2.y) * 0.5;
        const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        if (touchMode !== 'multi') {
          resetTouchGestureReference();
          return;
        }

        applyTouchPan(centerX - lastTouchCenter.x, centerY - lastTouchCenter.y);
        applyTouchZoom(distance - lastTouchDistance);
        applyTouchRoll(normalizeAngleDelta(angle - lastTouchAngle));

        lastTouchCenter.x = centerX;
        lastTouchCenter.y = centerY;
        lastTouchDistance = distance;
        lastTouchAngle = angle;
      }
      return;
    }

    if (!isDragging) return;
    const dx = ev.clientX - lastPointer.x;
    const dy = ev.clientY - lastPointer.y;
    const sensitivity = 0.003;
    const panSensitivity = 0.4;

    if (dragButton === 0) {
      updateOrientationVectors();
      const invert = getInvertLook();
      const yawDelta = dx * sensitivity * (invert ? -1 : 1);
      // Invert Y axis: positive dy should pitch upward by default
      const pitchDelta = dy * sensitivity * (invert ? -1 : 1);
      const yawRotation = Quaternion.RotationAxis(upDir, yawDelta);
      const pitchRotation = Quaternion.RotationAxis(rightDir, pitchDelta);
      orientation = pitchRotation.multiply(yawRotation).multiply(orientation);
      orientation.normalize();
    } else if (dragButton === 1) {
      updateOrientationVectors();
      const rollDelta = dx * sensitivity;
      const rollRotation = Quaternion.RotationAxis(forwardDir, rollDelta);
      orientation = rollRotation.multiply(orientation);
      orientation.normalize();
    } else if (dragButton === 2) {
      updateOrientationVectors();
      // Inverted pan: drag right -> pan left, drag up -> pan down.
      tmpScaled.copyFrom(rightDir).scaleInPlace(-dx * panSensitivity);
      camPos.addInPlace(tmpScaled);
      tmpScaled.copyFrom(upDir).scaleInPlace(dy * panSensitivity);
      camPos.addInPlace(tmpScaled);
    }

    lastPointer.x = ev.clientX;
    lastPointer.y = ev.clientY;
  };

  const endDrag = (ev: PointerEvent) => {
    if (ev.pointerType === 'touch') {
      touchPointers.delete(ev.pointerId);
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch {
        // Ignore pointer capture release errors from stale pointer IDs.
      }
      resetTouchGestureReference();
      return;
    }

    isDragging = false;
    dragButton = null;
    try {
      canvas.releasePointerCapture(ev.pointerId);
    } catch {
      // Ignore pointer capture release errors from stale pointer IDs.
    }
  };

  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const currentSpeed = getBaseMoveSpeed();
    setBaseMoveSpeed(wheelDeltaToCameraSpeed(currentSpeed, ev.deltaY));
  };

  const onContextMenu = (ev: MouseEvent) => {
    ev.preventDefault();
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.code in keys) {
      keys[ev.code] = true;
      ev.preventDefault();
    } else if (ev.code === 'KeyR') {
      recenterRequested = true;
    }
  };

  const onKeyUp = (ev: KeyboardEvent) => {
    if (ev.code in keys) {
      keys[ev.code] = false;
      ev.preventDefault();
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', endDrag);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  const update = (dt: number) => {
    const dynamicRadius = Math.max(getBoundsRadius(), 0.1);
    minDistance = Math.max(Math.min(dynamicRadius * 0.02, 12), 0.05);
    maxDistance = Math.max(dynamicRadius * 20, 1000);

    if (recenterRequested) {
      fitToBounds();
      recenterRequested = false;
    }

    updateOrientationVectors();
    moveDelta.set(0, 0, 0);

    const virtualMove = getVirtualMoveAxes();

    if (keys.KeyW) moveDelta.addInPlace(forwardDir);
    if (keys.KeyS) moveDelta.subtractInPlace(forwardDir);
    if (keys.KeyD) moveDelta.addInPlace(rightDir);
    if (keys.KeyA) moveDelta.subtractInPlace(rightDir);
    if (Math.abs(virtualMove.y) > 0.05) {
      tmpScaled.copyFrom(forwardDir).scaleInPlace(-virtualMove.y);
      moveDelta.addInPlace(tmpScaled);
    }
    if (Math.abs(virtualMove.x) > 0.05) {
      tmpScaled.copyFrom(rightDir).scaleInPlace(virtualMove.x);
      moveDelta.addInPlace(tmpScaled);
    }

    if (moveDelta.lengthSquared() > 0) {
      moveDelta.normalize();
      const baseSpeed = getBaseMoveSpeed();
      let speedMultiplier = 1;
      if (keys.AltLeft || keys.AltRight) speedMultiplier *= 8;
      if (keys.ShiftLeft || keys.ShiftRight) speedMultiplier *= 0.2;
      if (keys.ControlLeft || keys.ControlRight) speedMultiplier *= 2;
      const speed = baseSpeed * speedMultiplier * dt;
      moveDelta.scaleInPlace(speed);
      camPos.addInPlace(moveDelta);
    }

    applyCameraTransform();
  };

  const dispose = () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', endDrag);
    canvas.removeEventListener('pointercancel', endDrag);
    canvas.removeEventListener('pointerleave', endDrag);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };

  return {
    fitToBounds,
    requestRecenter: () => {
      recenterRequested = true;
    },
    update,
    dispose
  };
}
