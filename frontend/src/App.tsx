import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { shallow } from 'zustand/shallow';
import appStyles from './App.module.css';
import { MobileJoystick } from './components/hud/MobileJoystick';
import { HudPanel } from './components/hud/HudPanel';
import { SimControlDock } from './components/hud/SimControlDock';
import { ThreeNBody } from './graphics/ThreeNBody.tsx';
import { WS_URL } from './lib/config';
import { startFrameWebSocket, type SocketControls } from './lib/socketStream';
import { useFrameStore } from './state/useFrameStore';

const JOYSTICK_RADIUS_PX = 44;

type VirtualMoveState = {
  x: number;
  y: number;
};

type ViewportControlInsets = {
  bottom: number;
  right: number;
};

export default function App() {
  const {
    status,
    simPaused,
    simDt,
    hasSimControlSnapshot
  } = useFrameStore(
    (state) => ({
      status: state.status,
      simPaused: state.simPaused,
      simDt: state.simDt,
      hasSimControlSnapshot: state.hasSimControlSnapshot
    }),
    shallow
  );

  const socketControlsRef = useRef<SocketControls | null>(null);
  const controlsDisabled = status !== 'connected' || !hasSimControlSnapshot;

  const [virtualMove, setVirtualMove] = useState<VirtualMoveState>({ x: 0, y: 0 });
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

  const sendControlMessage = useCallback((message: string): boolean => {
    return socketControlsRef.current?.sendText(message) ?? false;
  }, []);

  const handleVirtualMoveChange = useCallback((x: number, y: number) => {
    setVirtualMove({ x, y });
  }, []);

  return (
    <div className={appStyles.appShell}>
      <ThreeNBody virtualMoveX={virtualMove.x} virtualMoveY={virtualMove.y} />
      <HudPanel
        status={status}
        controlsDisabled={controlsDisabled}
        onSendControlMessage={sendControlMessage}
      />
      <SimControlDock
        controlsDisabled={controlsDisabled}
        simPaused={simPaused}
        simDt={simDt}
        onSendControlMessage={sendControlMessage}
      />
      <MobileJoystick
        radiusPx={JOYSTICK_RADIUS_PX}
        bottomInsetPx={viewportControlInsets.bottom}
        rightInsetPx={viewportControlInsets.right}
        onMoveChange={handleVirtualMoveChange}
      />
    </div>
  );
}
