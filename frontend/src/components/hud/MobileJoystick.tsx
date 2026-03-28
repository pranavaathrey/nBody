import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import styles from './MobileJoystick.module.css';

type MobileJoystickProps = {
  radiusPx: number;
  bottomInsetPx: number;
  rightInsetPx: number;
  onMoveChange: (x: number, y: number) => void;
};

type JoystickState = {
  active: boolean;
  x: number;
  y: number;
};

export function MobileJoystick({
  radiusPx,
  bottomInsetPx,
  rightInsetPx,
  onMoveChange
}: MobileJoystickProps) {
  const [joystick, setJoystick] = useState<JoystickState>({ active: false, x: 0, y: 0 });
  const [joystickIdle, setJoystickIdle] = useState(false);
  const joystickInactiveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    joystickInactiveTimeoutRef.current = window.setTimeout(() => {
      setJoystickIdle(true);
      joystickInactiveTimeoutRef.current = null;
    }, 2000);

    return () => {
      if (joystickInactiveTimeoutRef.current !== null) {
        window.clearTimeout(joystickInactiveTimeoutRef.current);
        joystickInactiveTimeoutRef.current = null;
      }
      onMoveChange(0, 0);
    };
  }, [onMoveChange]);

  function registerJoystickInteraction(): void {
    setJoystickIdle(false);
    if (joystickInactiveTimeoutRef.current !== null) {
      window.clearTimeout(joystickInactiveTimeoutRef.current);
    }
    joystickInactiveTimeoutRef.current = window.setTimeout(() => {
      setJoystickIdle(true);
      joystickInactiveTimeoutRef.current = null;
    }, 1500);
  }

  function setJoystickPosition(active: boolean, x: number, y: number): void {
    setJoystick({ active, x, y });
    onMoveChange(x, y);
  }

  function updateJoystickFromPointer(ev: ReactPointerEvent<HTMLDivElement>): void {
    registerJoystickInteraction();
    const bounds = ev.currentTarget.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const dx = ev.clientX - centerX;
    const dy = ev.clientY - centerY;
    const distance = Math.hypot(dx, dy);
    const clampedDistance = Math.min(distance, radiusPx);
    const scale = distance > 0 ? clampedDistance / distance : 0;
    const nextX = (dx * scale) / radiusPx;
    const nextY = (dy * scale) / radiusPx;
    setJoystickPosition(true, nextX, nextY);
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
    registerJoystickInteraction();
    setJoystickPosition(false, 0, 0);
  }

  function handleJoystickPointerUp(ev: ReactPointerEvent<HTMLDivElement>): void {
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    }
    resetJoystick();
  }

  return (
    <div
      className={styles.mobileJoystickWrap}
      aria-hidden="true"
      style={
        {
          '--mobile-joystick-bottom': `${bottomInsetPx}px`,
          '--mobile-joystick-right': `${rightInsetPx}px`
        } as CSSProperties
      }
    >
      <div
        className={`${styles.mobileJoystick} ${joystick.active ? styles.isActive : ''} ${joystickIdle && !joystick.active ? styles.isIdle : ''}`.trim()}
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
        <div className={styles.mobileJoystickBase}>
          <div className={styles.mobileJoystickRing} />
          <div
            className={styles.mobileJoystickKnob}
            style={{
              transform: `translate(${(joystick.x * radiusPx).toFixed(1)}px, ${(joystick.y * radiusPx).toFixed(1)}px)`
            }}
          />
        </div>
      </div>
    </div>
  );
}
