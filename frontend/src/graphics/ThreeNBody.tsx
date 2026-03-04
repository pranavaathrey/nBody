import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrameStore } from '../state/useFrameStore';

export function ThreeNBody() {
  const hostRef = useRef<HTMLDivElement>(null);
  const needsFitRef = useRef(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060a);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 5000);
    camera.position.z = 3.0;
    const target = new THREE.Vector3(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(), 3));

    const sphereGeometry = new THREE.SphereGeometry(1, 16, 12);
    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: 0xf4c069,
      roughness: 0.35,
      metalness: 0.05
    });

    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    const keyLight = new THREE.DirectionalLight(0xfff1c1, 1.1);
    keyLight.position.set(2, 2, 2);
    scene.add(ambient, keyLight);

    let spheres: THREE.InstancedMesh | null = null;
    const instanceMatrix = new THREE.Matrix4();
    const instanceScale = new THREE.Vector3(1, 1, 1);
    const instanceQuat = new THREE.Quaternion();
    const instancePos = new THREE.Vector3();
    let bodyRadius = 0.01;

    const fitCameraToPoints = () => {
      const sphere = geometry.boundingSphere;
      if (!sphere) return;

      // Place the camera far enough back to fit the whole cloud and keep the
      // point size sensible at that distance.
      const fov = (camera.fov * Math.PI) / 180;
      const distance = (sphere.radius / Math.tan(fov / 2)) * 1.2;
      camera.position.set(sphere.center.x, sphere.center.y, sphere.center.z + distance);
      target.copy(sphere.center);
      camera.lookAt(target);
      camera.near = Math.max(0.01, distance * 0.01);
      camera.far = distance * 4;
      camera.updateProjectionMatrix();

      // Scale sphere radius with cloud radius so bodies stay visible.
      bodyRadius = Math.max(0.01, sphere.radius * 0.003);
    };

    // ------------ Interaction helpers ------------ //
    const panOffset = new THREE.Vector3();
    const panUp = new THREE.Vector3();
    const panRight = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const moveDelta = new THREE.Vector3();

    const pan = (deltaX: number, deltaY: number) => {
      const element = renderer.domElement;
      const distance = camera.position.distanceTo(target);
      const fov = (camera.fov * Math.PI) / 180;
      const height = 2 * Math.tan(fov / 2) * distance;
      // scale panning to viewport and scene size
      const panX = (-deltaX / element.clientHeight) * height;
      const panY = (deltaY / element.clientHeight) * height;

      panRight.setFromMatrixColumn(camera.matrix, 0).multiplyScalar(panX);
      panUp.setFromMatrixColumn(camera.matrix, 1).multiplyScalar(panY);
      panOffset.copy(panRight).add(panUp);

      camera.position.add(panOffset);
      target.add(panOffset);
    };

    const keys: Record<string, boolean> = { KeyW: false, KeyA: false, KeyS: false, KeyD: false };
    let lastPointer = new THREE.Vector2();
    let isDragging = false;

    const onPointerDown = (ev: PointerEvent) => {
      isDragging = true;
      lastPointer = new THREE.Vector2(ev.clientX, ev.clientY);
      host.setPointerCapture(ev.pointerId);
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (!isDragging) return;
      pan(ev.clientX - lastPointer.x, ev.clientY - lastPointer.y);
      lastPointer.set(ev.clientX, ev.clientY);
    };

    const endDrag = (ev: PointerEvent) => {
      isDragging = false;
      try {
        host.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code in keys) {
        keys[ev.code] = true;
        ev.preventDefault();
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code in keys) {
        keys[ev.code] = false;
        ev.preventDefault();
      }
    };

    const resize = () => {
      const width = host.clientWidth || window.innerWidth;
      const height = host.clientHeight || window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    resize();
    window.addEventListener('resize', resize);
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', endDrag);
    host.addEventListener('pointerleave', endDrag);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    let animationId = 0;
    let lastFrame = -1;
    let lastTime = performance.now();

    const renderLoop = () => {
      animationId = requestAnimationFrame(renderLoop);
      const state = useFrameStore.getState();
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (state.positions && state.frame !== lastFrame) {
        const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
        if (!attr || attr.count !== state.bodyCount) {
          geometry.setAttribute('position', new THREE.BufferAttribute(state.positions, 3));
          needsFitRef.current = true;
        } else {
          (attr.array as Float32Array).set(state.positions);
          attr.needsUpdate = true;
        }
        geometry.computeBoundingSphere();

        if (needsFitRef.current) {
          fitCameraToPoints();
          needsFitRef.current = false;
        }

        if (!spheres || spheres.count !== state.bodyCount) {
          if (spheres) {
            scene.remove(spheres);
            spheres.dispose();
          }
          const capacity = Math.max(state.bodyCount, 1);
          spheres = new THREE.InstancedMesh(sphereGeometry, sphereMaterial, capacity);
          spheres.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          scene.add(spheres);
        }

        if (spheres) {
          instanceScale.set(bodyRadius, bodyRadius, bodyRadius);
          instanceQuat.identity();

          for (let i = 0; i < state.bodyCount; i++) {
            instancePos.set(state.positions[i * 3], state.positions[i * 3 + 1], state.positions[i * 3 + 2]);
            instanceMatrix.compose(instancePos, instanceQuat, instanceScale);
            spheres.setMatrixAt(i, instanceMatrix);
          }
          spheres.count = state.bodyCount;
          spheres.instanceMatrix.needsUpdate = true;
        }

        lastFrame = state.frame;
      }

      // WASD fly-style movement in the ground plane
      if (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD) {
        forward.copy(camera.getWorldDirection(forward));
        forward.y = 0;
        if (forward.lengthSq() > 0) forward.normalize();
        panRight.crossVectors(forward, camera.up).normalize();

        moveDelta.set(0, 0, 0);
        const distance = camera.position.distanceTo(target);
        const moveSpeed = Math.max(1, distance * 0.5) * dt;

        if (keys.KeyW) moveDelta.add(forward);
        if (keys.KeyS) moveDelta.sub(forward);
        if (keys.KeyD) moveDelta.add(panRight);
        if (keys.KeyA) moveDelta.sub(panRight);

        if (moveDelta.lengthSq() > 0) {
          moveDelta.normalize().multiplyScalar(moveSpeed);
          camera.position.add(moveDelta);
          target.add(moveDelta);
        }
      }

      camera.lookAt(target);
      renderer.render(scene, camera);
    };

    renderLoop();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', endDrag);
      host.removeEventListener('pointerleave', endDrag);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      geometry.dispose();
      sphereGeometry.dispose();
      sphereMaterial.dispose();
      spheres?.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} className="canvas-host" />;
}
