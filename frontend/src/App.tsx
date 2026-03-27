import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent
} from 'react';
import { shallow } from 'zustand/shallow';
import { ThreeNBody } from './graphics/ThreeNBody.tsx';
import {
  logSliderValueToSpeed,
  speedToLogSliderValue,
  wheelDeltaToCameraSpeed
} from './graphics/threeNBody/cameraRig';
import { WS_URL } from './lib/config';
import { startFrameWebSocket, type SocketControls } from './lib/socketStream';
import { useFrameStore } from './state/useFrameStore';

const CAMERA_SPEED_TICK_EXPONENTS = [1, 2, 3, 4, 5, 6];
const JOYSTICK_RADIUS_PX = 44;
const BASE_SIM_DT = 0.016667;
const MIN_SIM_SPEED_MULTIPLIER = 0.1;
const MAX_SIM_SPEED_MULTIPLIER = 10;

type JoystickState = {
  active: boolean;
  x: number;
  y: number;
};

type ViewportControlInsets = {
  bottom: number;
  right: number;
};

function HudStats() {
  const { frame, bodyCount, fps, totalBytes } = useFrameStore(
    (state) => ({
      frame: state.frame,
      bodyCount: state.bodyCount,
      fps: state.fps,
      totalBytes: state.totalBytes
    }),
    shallow
  );

  return (
    <div className="hud-stats">
      <div className='stat-col'>
        <div><strong>FPS</strong> {fps.toFixed(1)}</div>
        <div><strong>Frame</strong> {frame}</div>
      </div>
      <div className='stat-col'>
        <div><strong>Received</strong> {(totalBytes / 1_000_000).toFixed(2)} MB</div>
        <div><strong>Bodies</strong> {bodyCount}</div>
      </div>
      <div className='stat-col'></div>
    </div>
  );
}

export default function App() {
  const {
    status,
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
    setCameraBaseMoveSpeed,
    simPaused,
    simDt,
    simPruningEnabled,
    hasSimControlSnapshot
  } = useFrameStore(
    (state) => ({
      status: state.status,
      showVelocityVectors: state.showVelocityVectors,
      setShowVelocityVectors: state.setShowVelocityVectors,
      showAccelerationVectors: state.showAccelerationVectors,
      setShowAccelerationVectors: state.setShowAccelerationVectors,
      showOrbitTrails: state.showOrbitTrails,
      setShowOrbitTrails: state.setShowOrbitTrails,
      showWorldGrid: state.showWorldGrid,
      setShowWorldGrid: state.setShowWorldGrid,
      invertLook: state.invertLook,
      setInvertLook: state.setInvertLook,
      cameraBaseMoveSpeed: state.cameraBaseMoveSpeed,
      setCameraBaseMoveSpeed: state.setCameraBaseMoveSpeed,
      simPaused: state.simPaused,
      simDt: state.simDt,
      simPruningEnabled: state.simPruningEnabled,
      hasSimControlSnapshot: state.hasSimControlSnapshot
    }),
    shallow
  );

  const sliderValue = speedToLogSliderValue(cameraBaseMoveSpeed);
  const sliderPercent = `${(sliderValue * 100).toFixed(2)}%`;
  const simSpeedMultiplier = Math.max(
    MIN_SIM_SPEED_MULTIPLIER,
    Math.min(MAX_SIM_SPEED_MULTIPLIER, simDt / BASE_SIM_DT)
  );
  const simSpeedSliderValue = Math.max(
    0,
    Math.min(1, (Math.log10(simSpeedMultiplier) + 1) / 2)
  );
  const simSpeedPercent = `${(simSpeedSliderValue * 100).toFixed(2)}%`;
  const socketControlsRef = useRef<SocketControls | null>(null);
  const speedPopoverRef = useRef<HTMLDivElement | null>(null);
  const speedPopoverCloseTimeoutRef = useRef<number | null>(null);
  const controlsDisabled = status !== 'connected' || !hasSimControlSnapshot;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hudMinimized, setHudMinimized] = useState(false);
  const [speedPopoverOpen, setSpeedPopoverOpen] = useState(false);
  const [joystick, setJoystick] = useState<JoystickState>({ active: false, x: 0, y: 0 });
  const [viewportControlInsets, setViewportControlInsets] = useState<ViewportControlInsets>({
    bottom: 20,
    right: 20
  });

  useEffect(() => {
    const { pushFrame, setStatus, setSimControlSnapshot } = useFrameStore.getState();
    const controls = startFrameWebSocket(WS_URL, pushFrame, setStatus, setSimControlSnapshot);
    socketControlsRef.current = controls;
    return () => {
      socketControlsRef.current = null;
      controls.close();
    };
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

  useEffect(() => {
    const handleSpaceToggle = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.repeat) {
        return;
      }

      if (ev.code !== 'Space' && ev.key !== ' ') {
        return;
      }

      const target = ev.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (
          tagName === 'INPUT'
          || tagName === 'TEXTAREA'
          || tagName === 'SELECT'
          || target.isContentEditable
        ) {
          return;
        }
      }

      ev.preventDefault();
      if (controlsDisabled) {
        return;
      }

      socketControlsRef.current?.sendText(`control:set?paused=${simPaused ? 0 : 1}`);
    };

    window.addEventListener('keydown', handleSpaceToggle);
    return () => {
      window.removeEventListener('keydown', handleSpaceToggle);
    };
  }, [controlsDisabled, simPaused]);

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

  function sendControlMessage(message: string): boolean {
    return socketControlsRef.current?.sendText(message) ?? false;
  }

  function sliderToSimSpeedMultiplier(value: number): number {
    return Math.pow(10, 2 * value - 1);
  }

  function handleSimSpeedChange(nextSliderValue: number): void {
    if (controlsDisabled) {
      return;
    }

    const clampedSliderValue = Math.max(0, Math.min(1, nextSliderValue));
    const nextMultiplier = sliderToSimSpeedMultiplier(clampedSliderValue);
    const nextDt = BASE_SIM_DT * nextMultiplier;
    sendControlMessage(`control:set?dt=${encodeURIComponent(nextDt.toFixed(6))}`);
  }

  useEffect(() => {
    if (controlsDisabled) {
      if (speedPopoverCloseTimeoutRef.current !== null) {
        window.clearTimeout(speedPopoverCloseTimeoutRef.current);
        speedPopoverCloseTimeoutRef.current = null;
      }
      setSpeedPopoverOpen(false);
    }
  }, [controlsDisabled]);

  useEffect(() => {
    return () => {
      if (speedPopoverCloseTimeoutRef.current !== null) {
        window.clearTimeout(speedPopoverCloseTimeoutRef.current);
        speedPopoverCloseTimeoutRef.current = null;
      }
    };
  }, []);

  function clearSpeedPopoverCloseTimeout(): void {
    if (speedPopoverCloseTimeoutRef.current !== null) {
      window.clearTimeout(speedPopoverCloseTimeoutRef.current);
      speedPopoverCloseTimeoutRef.current = null;
    }
  }

  function queueSpeedPopoverClose(): void {
    clearSpeedPopoverCloseTimeout();
    speedPopoverCloseTimeoutRef.current = window.setTimeout(() => {
      setSpeedPopoverOpen(false);
      speedPopoverCloseTimeoutRef.current = null;
    }, 350);
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
      <div className="hud-column">
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
              <small>Stats</small>
              <HudStats />
              <div className="settings-section">
                <button
                  className="hud-settings-toggle"
                  type="button"
                  onClick={() => setSettingsOpen((s) => !s)}
                  aria-expanded={settingsOpen}
                  aria-controls="hud-settings-panel"
                >
                  <span className="hud-settings-label">Settings</span>
                  <span className="hud-settings-arrow" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </span>
                </button>
                <div
                  id="hud-settings-panel"
                  className={`hud-settings-panel ${settingsOpen ? 'is-open' : ''}`}
                  aria-hidden={!settingsOpen}
                >
                  <fieldset className="hud-settings-fieldset" disabled={!settingsOpen}>
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
                      <label className="hud-toggle">
                        <input
                          type="checkbox"
                          checked={simPruningEnabled}
                          onChange={(ev) => {
                            if (controlsDisabled) {
                              return;
                            }
                            sendControlMessage(`control:set?pruning=${ev.target.checked ? 1 : 0}`);
                          }}
                        />
                        Enable pruning
                      </label>
                    </div>
                    </div>
                  </fieldset>
                  </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="sim-control-dock">
        <div className="sim-control-floating-group" role="group" aria-label="Simulation controls">
          <button
            className={`sim-control-fab ${simPaused ? 'is-paused' : ''}`}
            type="button"
            aria-label={simPaused ? 'Resume simulation' : 'Pause simulation'}
            title={simPaused ? 'Resume simulation' : 'Pause simulation'}
            disabled={controlsDisabled}
            onClick={() => {
              if (controlsDisabled) {
                return;
              }
              sendControlMessage(`control:set?paused=${simPaused ? 0 : 1}`);
            }}
          >
            {simPaused ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="14" y="3" width="5" height="18" rx="1"/>
                <rect x="5" y="3" width="5" height="18" rx="1"/>
              </svg>
            )}
          </button>
          <button
            className="sim-control-fab"
            type="button"
            aria-label="Reset simulation"
            title="Reset simulation"
            disabled={controlsDisabled}
            onClick={() => {
              if (controlsDisabled) {
                return;
              }
              sendControlMessage('control:reset');
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
          </button>
          <div ref={speedPopoverRef} className={`sim-control-speed-wrap ${speedPopoverOpen ? 'is-open' : ''}`}>
            <button
              className="sim-control-fab"
              type="button"
              aria-label="Adjust simulation speed"
              aria-haspopup="dialog"
              aria-expanded={speedPopoverOpen}
              title={`Time speed: ${simSpeedMultiplier.toFixed(2)}x`}
              disabled={controlsDisabled}
              onClick={() => {
                if (controlsDisabled) {
                  return;
                }
                clearSpeedPopoverCloseTimeout();
                setSpeedPopoverOpen((open) => !open);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m12 14 4-4"/>
                <path d="M3.34 19a10 10 0 1 1 17.32 0"/>
              </svg>
            </button>
            <div
              className="sim-control-speed-popover"
              role="dialog"
              aria-label="Simulation speed"
              data-open={speedPopoverOpen}
              aria-hidden={!speedPopoverOpen}
              onMouseEnter={clearSpeedPopoverCloseTimeout}
              onMouseLeave={queueSpeedPopoverClose}
            >
              <label className="hud-slider sim-control-speed-slider">
                <span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m12 14 4-4"/>
                    <path d="M3.34 19a10 10 0 1 1 17.32 0"/>
                  </svg>
                  <span>Time speed: {simSpeedMultiplier.toFixed(2)}x</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={simSpeedSliderValue}
                  style={
                    {
                      '--percent': simSpeedPercent
                    } as CSSProperties
                  }
                  onChange={(ev) => handleSimSpeedChange(Number(ev.target.value))}
                />
                <div className="sim-control-speed-scale" aria-hidden="true">
                  <span>0.1x</span>
                  <span>1x</span>
                  <span>10x</span>
                </div>
              </label>
            </div>
          </div>
        </div>
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
