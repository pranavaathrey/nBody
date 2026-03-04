import { useEffect } from 'react';
import { ThreeNBody } from './graphics/ThreeNBody';
import { WS_URL } from './lib/config';
import { startFrameWebSocket } from './lib/socketStream';
import { useFrameStore } from './state/useFrameStore';

export default function App() {
  const { frame, bodyCount, fps, status, totalBytes } = useFrameStore();

  useEffect(() => {
    const { pushFrame, setStatus } = useFrameStore.getState();
    const controls = startFrameWebSocket(WS_URL, pushFrame, setStatus);
    return () => controls.close();
  }, []);

  return (
    <div className="app-shell">
      <ThreeNBody />
      <div className="hud">
        <div>
          <span className={`dot ${status === 'connected' ? 'ok' : ''}`}></span>
          WS {status} · {WS_URL}
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
      </div>
    </div>
  );
}
