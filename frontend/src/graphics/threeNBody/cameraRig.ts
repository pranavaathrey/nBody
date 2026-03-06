import { Matrix, Quaternion, UniversalCamera, Vector3 } from '@babylonjs/core';

type CameraRigOptions = {
  canvas: HTMLCanvasElement;
  camera: UniversalCamera;
  getBoundsCenter: () => Vector3;
  getBoundsRadius: () => number;
  getInvertLook: () => boolean;
  getBaseMoveSpeed: () => number;
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
    getInvertLook,
    getBaseMoveSpeed
  } = options;

  let orientation = Quaternion.FromEulerAngles(0, Math.PI, 0);
  let camPos = new Vector3(0, 0, 3);
  let minDistance = 0.1;
  let maxDistance = 1000;

  let isDragging = false;
  let dragButton: number | null = null;
  const lastPointer = { x: 0, y: 0 };
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
  const rotMat = Matrix.Identity();

  const updateOrientationVectors = () => {
    orientation.normalize();
    orientation.toRotationMatrix(rotMat);
    Vector3.TransformNormalToRef(Vector3.Forward(), rotMat, forwardDir);
    forwardDir.normalize();
    Vector3.TransformNormalToRef(Vector3.Right(), rotMat, rightDir);
    rightDir.normalize();
    Vector3.TransformNormalToRef(Vector3.Up(), rotMat, upDir);
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
    camPos = new Vector3(boundsCenter.x, boundsCenter.y, boundsCenter.z + clamped);
    applyCameraTransform();
  };

  const onPointerDown = (ev: PointerEvent) => {
    isDragging = true;
    dragButton = ev.button;
    lastPointer.x = ev.clientX;
    lastPointer.y = ev.clientY;
    canvas.setPointerCapture(ev.pointerId);
  };

  const onPointerMove = (ev: PointerEvent) => {
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
      camPos.addInPlace(rightDir.scale(-dx * panSensitivity));
      camPos.addInPlace(upDir.scale(dy * panSensitivity));
    }

    lastPointer.x = ev.clientX;
    lastPointer.y = ev.clientY;
  };

  const endDrag = (ev: PointerEvent) => {
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
    applyCameraTransform();

    const move = -ev.deltaY * 0.8;
    camPos.addInPlace(forwardDir.scale(move));

    const boundsCenter = getBoundsCenter();
    const distFromBounds = camPos.subtract(boundsCenter).length();
    const clampedDist = Math.min(Math.max(distFromBounds, minDistance), maxDistance);
    const dirFromBounds = camPos.subtract(boundsCenter).normalize();
    camPos = boundsCenter.add(dirFromBounds.scale(clampedDist));
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

    if (keys.KeyW) moveDelta.addInPlace(forwardDir);
    if (keys.KeyS) moveDelta.subtractInPlace(forwardDir);
    if (keys.KeyD) moveDelta.addInPlace(rightDir);
    if (keys.KeyA) moveDelta.subtractInPlace(rightDir);

    if (moveDelta.lengthSquared() > 0) {
      moveDelta.normalize();
      const baseSpeed = getBaseMoveSpeed();
      let speedMultiplier = 1;
      if (keys.AltLeft || keys.AltRight) speedMultiplier *= 10;
      if (keys.ShiftLeft || keys.ShiftRight) speedMultiplier *= 3;
      if (keys.ControlLeft || keys.ControlRight) speedMultiplier *= 0.2;
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
