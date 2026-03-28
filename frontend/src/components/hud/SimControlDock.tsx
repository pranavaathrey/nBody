import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './SimControlDock.module.css';

const BASE_SIM_DT = 0.016667;
const MIN_SIM_SPEED_MULTIPLIER = 0.1;
const MAX_SIM_SPEED_MULTIPLIER = 10;
const MIN_KEYBOARD_SIM_SPEED_MULTIPLIER = 0.01;

type SimControlDockProps = {
  controlsDisabled: boolean;
  simPaused: boolean;
  simDt: number;
  onSendControlMessage: (message: string) => boolean;
};

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }

  const tagName = element.tagName;
  return (
    tagName === 'INPUT'
    || tagName === 'TEXTAREA'
    || tagName === 'SELECT'
    || element.isContentEditable
  );
}

function sliderToSimSpeedMultiplier(value: number): number {
  return Math.pow(10, 2 * value - 1);
}

export function SimControlDock({
  controlsDisabled,
  simPaused,
  simDt,
  onSendControlMessage
}: SimControlDockProps) {
  const speedPopoverCloseTimeoutRef = useRef<number | null>(null);
  const [speedPopoverOpen, setSpeedPopoverOpen] = useState(false);

  const simSpeedMultiplier = Math.max(MIN_KEYBOARD_SIM_SPEED_MULTIPLIER, simDt / BASE_SIM_DT);
  const sliderBoundedMultiplier = Math.max(
    MIN_SIM_SPEED_MULTIPLIER,
    Math.min(MAX_SIM_SPEED_MULTIPLIER, simDt / BASE_SIM_DT)
  );
  const simSpeedSliderValue = Math.max(0, Math.min(1, (Math.log10(sliderBoundedMultiplier) + 1) / 2));
  const simSpeedPercent = `${(simSpeedSliderValue * 100).toFixed(2)}%`;

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

  function handleSimSpeedChange(nextSliderValue: number): void {
    if (controlsDisabled) {
      return;
    }

    const clampedSliderValue = Math.max(0, Math.min(1, nextSliderValue));
    const nextMultiplier = sliderToSimSpeedMultiplier(clampedSliderValue);
    const nextDt = BASE_SIM_DT * nextMultiplier;
    onSendControlMessage(`control:set?dt=${encodeURIComponent(nextDt.toFixed(6))}`);
  }

  useEffect(() => {
    if (controlsDisabled) {
      clearSpeedPopoverCloseTimeout();
      setSpeedPopoverOpen(false);
    }
  }, [controlsDisabled]);

  useEffect(() => {
    return () => {
      clearSpeedPopoverCloseTimeout();
    };
  }, []);

  useEffect(() => {
    const handleSpaceToggle = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.repeat || controlsDisabled) {
        return;
      }

      if (ev.code !== 'Space' && ev.key !== ' ') {
        return;
      }

      if (isEditableTarget(ev.target)) {
        return;
      }

      ev.preventDefault();
      onSendControlMessage(`control:set?paused=${simPaused ? 0 : 1}`);
    };

    window.addEventListener('keydown', handleSpaceToggle);
    return () => {
      window.removeEventListener('keydown', handleSpaceToggle);
    };
  }, [controlsDisabled, onSendControlMessage, simPaused]);

  useEffect(() => {
    const handleTimeSpeedStep = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.repeat || controlsDisabled) {
        return;
      }

      if (isEditableTarget(ev.target)) {
        return;
      }

      const decreaseSpeed = ev.code === 'BracketLeft' || ev.key === '[';
      const increaseSpeed = ev.code === 'BracketRight' || ev.key === ']';
      if (!decreaseSpeed && !increaseSpeed) {
        return;
      }

      ev.preventDefault();
      const delta = increaseSpeed ? 1 : -1;
      const nextMultiplier = Math.max(MIN_KEYBOARD_SIM_SPEED_MULTIPLIER, simSpeedMultiplier + delta);
      const nextDt = BASE_SIM_DT * nextMultiplier;
      onSendControlMessage(`control:set?dt=${encodeURIComponent(nextDt.toFixed(6))}`);
    };

    window.addEventListener('keydown', handleTimeSpeedStep);
    return () => {
      window.removeEventListener('keydown', handleTimeSpeedStep);
    };
  }, [controlsDisabled, onSendControlMessage, simSpeedMultiplier]);

  return (
    <div className={styles.simControlDock}>
      <div className={styles.simControlFloatingGroup} role="group" aria-label="Simulation controls">
        <button
          className={`${styles.simControlFab} ${simPaused ? styles.isPaused : ''}`.trim()}
          type="button"
          aria-label={simPaused ? 'Resume simulation' : 'Pause simulation'}
          title={simPaused ? 'Resume simulation' : 'Pause simulation'}
          disabled={controlsDisabled}
          onClick={() => {
            if (controlsDisabled) {
              return;
            }
            onSendControlMessage(`control:set?paused=${simPaused ? 0 : 1}`);
          }}
        >
          {simPaused ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="14" y="3" width="5" height="18" rx="1" />
              <rect x="5" y="3" width="5" height="18" rx="1" />
            </svg>
          )}
        </button>
        <button
          className={styles.simControlFab}
          type="button"
          aria-label="Reset simulation"
          title="Reset simulation"
          disabled={controlsDisabled}
          onClick={() => {
            if (controlsDisabled) {
              return;
            }
            onSendControlMessage('control:reset');
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
        <div className={styles.simControlSpeedWrap}>
          <button
            className={styles.simControlFab}
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
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m12 14 4-4" />
              <path d="M3.34 19a10 10 0 1 1 17.32 0" />
            </svg>
          </button>
          <div
            className={styles.simControlSpeedPopover}
            role="dialog"
            aria-label="Simulation speed"
            data-open={speedPopoverOpen}
            aria-hidden={!speedPopoverOpen}
            onMouseEnter={clearSpeedPopoverCloseTimeout}
            onMouseLeave={queueSpeedPopoverClose}
          >
            <label className={`${styles.hudSlider} ${styles.simControlSpeedSlider}`.trim()}>
              <span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m12 14 4-4" />
                  <path d="M3.34 19a10 10 0 1 1 17.32 0" />
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
              <div className={styles.simControlSpeedScale} aria-hidden="true">
                <span>0.1x</span>
                <span>1x</span>
                <span>10x</span>
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
