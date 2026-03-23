import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { ThreeNBody } from './graphics/ThreeNBody.tsx';
import {
  logSliderValueToSpeed,
  speedToLogSliderValue,
  wheelDeltaToCameraSpeed
} from './graphics/threeNBody/cameraRig';
import { WS_URL } from './lib/config';
import { startFrameWebSocket } from './lib/socketStream';
import { useFrameStore } from './state/useFrameStore';

const CAMERA_SPEED_TICK_EXPONENTS = [1, 2, 3, 4, 5, 6];
const JOYSTICK_RADIUS_PX = 44;

type JoystickState = {
  active: boolean;
  x: number;
  y: number;
};

type ViewportControlInsets = {
  bottom: number;
  right: number;
};

export default function App() {
  const {
    frame,
    bodyCount,
    fps,
    status,
    totalBytes,
    showVelocityVectors,
    setShowVelocityVectors,
    showAccelerationVectors,
    setShowAccelerationVectors,
    showOrbitTrails,
    setShowOrbitTrails,
    showWorldGrid,
    setShowWorldGrid,
    invertLook,
    setInvertLook,
    cameraBaseMoveSpeed,
    setCameraBaseMoveSpeed
  } = useFrameStore();

  const sliderValue = speedToLogSliderValue(cameraBaseMoveSpeed);
  const sliderPercent = `${(sliderValue * 100).toFixed(2)}%`;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hudMinimized, setHudMinimized] = useState(false);
  const [joystick, setJoystick] = useState<JoystickState>({ active: false, x: 0, y: 0 });
  const [viewportControlInsets, setViewportControlInsets] = useState<ViewportControlInsets>({
    bottom: 20,
    right: 20
  });

  useEffect(() => {
    const { pushFrame, setStatus } = useFrameStore.getState();
    const controls = startFrameWebSocket(WS_URL, pushFrame, setStatus);
    return () => controls.close();
  }, []);

  useEffect(() => {
    const visualViewport = window.visualViewport;

    const updateViewportControlInsets = () => {
      const root = document.documentElement;
      const layoutWidth = root.clientWidth || window.innerWidth;
      const layoutHeight = root.clientHeight || window.innerHeight;

      if (!visualViewport) {
        setViewportControlInsets({ bottom: 20, right: 20 });
        return;
      }

      const rightInset = Math.max(
        0,
        Math.ceil(layoutWidth - (visualViewport.offsetLeft + visualViewport.width))
      );
      const bottomInset = Math.max(
        0,
        Math.ceil(layoutHeight - (visualViewport.offsetTop + visualViewport.height))
      );

      setViewportControlInsets({
        bottom: 20 + bottomInset,
        right: 20 + rightInset
      });
    };

    updateViewportControlInsets();
    window.addEventListener('resize', updateViewportControlInsets);
    visualViewport?.addEventListener('resize', updateViewportControlInsets);
    visualViewport?.addEventListener('scroll', updateViewportControlInsets);

    return () => {
      window.removeEventListener('resize', updateViewportControlInsets);
      visualViewport?.removeEventListener('resize', updateViewportControlInsets);
      visualViewport?.removeEventListener('scroll', updateViewportControlInsets);
    };
  }, []);

  function handleCameraSpeedWheel(ev: WheelEvent<HTMLInputElement>): void {
    ev.preventDefault();
    setCameraBaseMoveSpeed(wheelDeltaToCameraSpeed(cameraBaseMoveSpeed, ev.deltaY));
  }

  function handleToggleHudMinimized(): void {
    setHudMinimized((current) => {
      const next = !current;
      if (next) {
        setSettingsOpen(false);
      }
      return next;
    });
  }

  function updateJoystickFromPointer(ev: ReactPointerEvent<HTMLDivElement>): void {
    const bounds = ev.currentTarget.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const dx = ev.clientX - centerX;
    const dy = ev.clientY - centerY;
    const distance = Math.hypot(dx, dy);
    const clampedDistance = Math.min(distance, JOYSTICK_RADIUS_PX);
    const scale = distance > 0 ? clampedDistance / distance : 0;
    const nextX = (dx * scale) / JOYSTICK_RADIUS_PX;
    const nextY = (dy * scale) / JOYSTICK_RADIUS_PX;
    setJoystick({ active: true, x: nextX, y: nextY });
  }

  function handleJoystickPointerDown(ev: ReactPointerEvent<HTMLDivElement>): void {
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    updateJoystickFromPointer(ev);
  }

  function handleJoystickPointerMove(ev: ReactPointerEvent<HTMLDivElement>): void {
    if ((ev.buttons & 1) === 0 && ev.pointerType !== 'touch') {
      return;
    }
    if (!joystick.active && ev.pointerType !== 'touch') {
      return;
    }
    ev.preventDefault();
    updateJoystickFromPointer(ev);
  }

  function resetJoystick(): void {
    setJoystick({ active: false, x: 0, y: 0 });
  }

  function handleJoystickPointerUp(ev: ReactPointerEvent<HTMLDivElement>): void {
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    }
    resetJoystick();
  }

  return (
    <div
      className="app-shell"
      style={
        {
          '--mobile-joystick-bottom': `${viewportControlInsets.bottom}px`,
          '--mobile-joystick-right': `${viewportControlInsets.right}px`
        } as CSSProperties
      }
    >
      <ThreeNBody virtualMoveX={joystick.x} virtualMoveY={joystick.y} />
      <div className={`hud ${hudMinimized ? 'hud-minimized' : ''}`}>
        <div className="hud-header">
          {!hudMinimized && <h1>N Body Simulation</h1>}
          <button
            className="hud-icon-button"
            type="button"
            onClick={handleToggleHudMinimized}
            aria-label={hudMinimized ? 'Expand HUD panel' : 'Minimize HUD panel'}
            title={hudMinimized ? 'Expand HUD panel' : 'Minimize HUD panel'}
          >
            {hudMinimized ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
                <path d="M4 5h16"/>
                <path d="M4 12h16"/>
                <path d="M4 19h16"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
                <path d="m14 10 7-7" />
                <path d="M20 10h-6V4" />
                <path d="m3 21 7-7" />
                <path d="M4 14h6v6" />
              </svg>
            )}
          </button>
        </div>
        {!hudMinimized && (
          <>
            <div>
              <span className={`dot ${status === 'connected' ? 'ok' : ''}`}></span>
              {status} · <small>{WS_URL}</small>
            </div>
            <div>
              <strong>Frame</strong> {frame}
            </div>
            <div>
              <strong>Bodies</strong> {bodyCount}
            </div>
            <div>
              <strong>FPS</strong> {fps.toFixed(1)}
            </div>
            <div>
              <strong>Received</strong> {(totalBytes / 1_000_000).toFixed(2)} MB
            </div>
            <div>
              <button
                className="hud-settings-toggle"
                onClick={() => setSettingsOpen((s) => !s)}
                aria-expanded={settingsOpen}
              >
                <span className="hud-settings-label">Settings</span>
                <span className="hud-settings-arrow" aria-hidden="true">
                  {settingsOpen ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  )}
                </span>
              </button>
              {settingsOpen && (
                <div className="hud-settings">
                  <div className="hud-section">
                    <div className="hud-section-title">Vector visibility</div>
                    <label className="hud-toggle">
                      <input
                        type="checkbox"
                        checked={showVelocityVectors}
                        onChange={(ev) => setShowVelocityVectors(ev.target.checked)}
                      />
                      Velocity vectors
                    </label>
                    <label className="hud-toggle">
                      <input
                        type="checkbox"
                        checked={showAccelerationVectors}
                        onChange={(ev) => setShowAccelerationVectors(ev.target.checked)}
                      />
                      Acceleration vectors
                    </label>
                  </div>
                  <div className="hud-section">
                    <div className="hud-section-title">Camera options</div>
                    <label className="hud-slider">
                      <span>Base movement speed: {cameraBaseMoveSpeed.toLocaleString()} units</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.001}
                        value={sliderValue}
                        style={
                          {
                            '--percent': sliderPercent
                          } as CSSProperties
                        }
                        onChange={(ev) =>
                          setCameraBaseMoveSpeed(logSliderValueToSpeed(Number(ev.target.value)))
                        }
                        onWheel={handleCameraSpeedWheel}
                      />
                      <div className="hud-slider-scale" aria-hidden="true">
                        {CAMERA_SPEED_TICK_EXPONENTS.map((exponent) => {
                          return (
                            <span key={exponent} className="hud-slider-scale-tick">
                              <span className="hud-slider-scale-line" />
                              <span className="hud-slider-scale-label">10<sup>{exponent}</sup></span>
                            </span>
                          );
                        })}
                      </div>
                    </label>
                    <label className="hud-toggle">
                      <input
                        type="checkbox"
                        checked={invertLook}
                        onChange={(ev) => setInvertLook(ev.target.checked)}
                      />
                      Invert look axes
                    </label>
                  </div>
                  <div className="hud-section">
                    <div className="hud-section-title">Other</div>
                    <label className="hud-toggle">
                      <input
                        type="checkbox"
                        checked={showOrbitTrails}
                        onChange={(ev) => setShowOrbitTrails(ev.target.checked)}
                      />
                      Orbit trails
                    </label>
                    <label className="hud-toggle">
                      <input
                        type="checkbox"
                        checked={showWorldGrid}
                        onChange={(ev) => setShowWorldGrid(ev.target.checked)}
                      />
                      World grid
                    </label>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="mobile-joystick-wrap" aria-hidden="true">
        <div
          className={`mobile-joystick ${joystick.active ? 'is-active' : ''}`}
          onPointerDown={handleJoystickPointerDown}
          onPointerMove={handleJoystickPointerMove}
          onPointerUp={handleJoystickPointerUp}
          onPointerCancel={handleJoystickPointerUp}
          onPointerLeave={(ev) => {
            if (ev.pointerType === 'mouse' && !joystick.active) {
              return;
            }
            handleJoystickPointerUp(ev);
          }}
        >
          <div className="mobile-joystick-base">
            <div className="mobile-joystick-ring" />
            <div
              className="mobile-joystick-knob"
              style={{
                transform: `translate(${(joystick.x * JOYSTICK_RADIUS_PX).toFixed(1)}px, ${(joystick.y * JOYSTICK_RADIUS_PX).toFixed(1)}px)`
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
