import { useEffect, useState, type CSSProperties } from 'react';
import { ThreeNBody } from './graphics/ThreeNBody.tsx';
import { WS_URL } from './lib/config';
import { startFrameWebSocket } from './lib/socketStream';
import { useFrameStore } from './state/useFrameStore';

const CAMERA_SPEED_MIN = 10;
const CAMERA_SPEED_MAX = 1_000_000;
const CAMERA_SPEED_LOG_MIN = Math.log10(CAMERA_SPEED_MIN);
const CAMERA_SPEED_LOG_MAX = Math.log10(CAMERA_SPEED_MAX);
const CAMERA_SPEED_TICK_EXPONENTS = [1, 2, 3, 4, 5, 6];

function speedToLogSliderValue(speed: number): number {
  const clamped = Math.max(CAMERA_SPEED_MIN, Math.min(CAMERA_SPEED_MAX, speed));
  const normalized =
    (Math.log10(clamped) - CAMERA_SPEED_LOG_MIN) / (CAMERA_SPEED_LOG_MAX - CAMERA_SPEED_LOG_MIN);
  return Math.max(0, Math.min(1, normalized));
}

function logSliderValueToSpeed(sliderValue: number): number {
  const normalized = Math.max(0, Math.min(1, sliderValue));
  const exponent = CAMERA_SPEED_LOG_MIN + normalized * (CAMERA_SPEED_LOG_MAX - CAMERA_SPEED_LOG_MIN);
  return Math.round(Math.pow(10, exponent));
}

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
    invertLook,
    setInvertLook,
    cameraBaseMoveSpeed,
    setCameraBaseMoveSpeed
  } = useFrameStore();

  const sliderValue = speedToLogSliderValue(cameraBaseMoveSpeed);
  const sliderPercent = `${(sliderValue * 100).toFixed(2)}%`;

  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const { pushFrame, setStatus } = useFrameStore.getState();
    const controls = startFrameWebSocket(WS_URL, pushFrame, setStatus);
    return () => controls.close();
  }, []);

  return (
    <div className="app-shell">
      <ThreeNBody />
      <div className="hud">
        <h1>N Body Simulation</h1>
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
            <span className="hud-settings-arrow" aria-hidden="true">{settingsOpen ? '▾' : '▸'}</span>
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
                <label className="hud-toggle">
                  <input
                    type="checkbox"
                    checked={invertLook}
                    onChange={(ev) => setInvertLook(ev.target.checked)}
                  />
                  Invert look axes
                </label>
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
