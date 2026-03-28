import { type CSSProperties, type WheelEvent } from 'react';
import { shallow } from 'zustand/shallow';
import {
  logSliderValueToSpeed,
  speedToLogSliderValue,
  wheelDeltaToCameraSpeed
} from '../../graphics/threeNBody/cameraRig';
import { useFrameStore } from '../../state/useFrameStore';
import styles from './HudPanel.module.css';

const CAMERA_SPEED_TICK_EXPONENTS = [1, 2, 3, 4, 5, 6];

type HudSettingsProps = {
  settingsOpen: boolean;
  onToggleSettings: () => void;
  controlsDisabled: boolean;
  onSendControlMessage: (message: string) => boolean;
};

export function HudSettings({
  settingsOpen,
  onToggleSettings,
  controlsDisabled,
  onSendControlMessage
}: HudSettingsProps) {
  const {
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
    simPruningEnabled
  } = useFrameStore(
    (state) => ({
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
      simPruningEnabled: state.simPruningEnabled
    }),
    shallow
  );

  const sliderValue = speedToLogSliderValue(cameraBaseMoveSpeed);
  const sliderPercent = `${(sliderValue * 100).toFixed(2)}%`;

  function handleCameraSpeedWheel(ev: WheelEvent<HTMLInputElement>): void {
    ev.preventDefault();
    setCameraBaseMoveSpeed(wheelDeltaToCameraSpeed(cameraBaseMoveSpeed, ev.deltaY));
  }

  return (
    <div className={styles.settingsSection}>
      <button
        className={styles.hudSettingsToggle}
        type="button"
        onClick={onToggleSettings}
        aria-expanded={settingsOpen}
        aria-controls="hud-settings-panel"
      >
        <span>Settings</span>
        <span className={styles.hudSettingsArrow} aria-hidden="true">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
      </button>
      <div
        id="hud-settings-panel"
        className={`${styles.hudSettingsPanel} ${settingsOpen ? styles.isOpen : ''}`.trim()}
        aria-hidden={!settingsOpen}
      >
        <fieldset className={styles.hudSettingsFieldset} disabled={!settingsOpen}>
          <div className={styles.hudSettings}>
            <div className={styles.hudSection}>
              <div className={styles.hudSectionTitle}>Vector visibility</div>
              <label className={styles.hudToggle}>
                <input
                  type="checkbox"
                  checked={showVelocityVectors}
                  onChange={(ev) => setShowVelocityVectors(ev.target.checked)}
                />
                Velocity vectors
              </label>
              <label className={styles.hudToggle}>
                <input
                  type="checkbox"
                  checked={showAccelerationVectors}
                  onChange={(ev) => setShowAccelerationVectors(ev.target.checked)}
                />
                Acceleration vectors
              </label>
            </div>
            <div className={styles.hudSection}>
              <div className={styles.hudSectionTitle}>Camera options</div>
              <label className={styles.hudSlider}>
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
                <div className={styles.hudSliderScale} aria-hidden="true">
                  {CAMERA_SPEED_TICK_EXPONENTS.map((exponent) => {
                    return (
                      <span key={exponent} className={styles.hudSliderScaleTick}>
                        <span className={styles.hudSliderScaleLine} />
                        <span className={styles.hudSliderScaleLabel}>
                          10<sup>{exponent}</sup>
                        </span>
                      </span>
                    );
                  })}
                </div>
              </label>
              <label className={styles.hudToggle}>
                <input
                  type="checkbox"
                  checked={invertLook}
                  onChange={(ev) => setInvertLook(ev.target.checked)}
                />
                Invert look axes
              </label>
            </div>
            <div className={styles.hudSection}>
              <div className={styles.hudSectionTitle}>Other</div>
              <label className={styles.hudToggle}>
                <input
                  type="checkbox"
                  checked={showOrbitTrails}
                  onChange={(ev) => setShowOrbitTrails(ev.target.checked)}
                />
                Orbit trails
              </label>
              <label className={styles.hudToggle}>
                <input
                  type="checkbox"
                  checked={showWorldGrid}
                  onChange={(ev) => setShowWorldGrid(ev.target.checked)}
                />
                World grid
              </label>
              <label className={styles.hudToggle}>
                <input
                  type="checkbox"
                  checked={simPruningEnabled}
                  onChange={(ev) => {
                    if (controlsDisabled) {
                      return;
                    }
                    onSendControlMessage(`control:set?pruning=${ev.target.checked ? 1 : 0}`);
                  }}
                />
                Enable pruning
              </label>
            </div>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
