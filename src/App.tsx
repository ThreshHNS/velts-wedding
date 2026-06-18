import { useEffect, useRef, useState } from 'react';
import type { GameController } from './game/WeddingGame';

const LANDING_URL = '/main/';

export function App() {
  const gameRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<GameController | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    if (!gameRef.current) return undefined;
    let cancelled = false;
    const parent = gameRef.current;
    const ready = () => {
      window.clearTimeout(timeout);
      setStatus((current) => (current === 'error' ? 'error' : 'ready'));
    };
    const fail = () => setStatus('error');
    const timeout = window.setTimeout(fail, 16000);

    window.addEventListener('wedding-game-ready', ready);
    window.addEventListener('wedding-game-error', fail);
    import('./game/WeddingGame')
      .then(({ mountWeddingGame }) => {
        if (cancelled || !parent) return;
        const controller = mountWeddingGame(parent);
        controllerRef.current = controller;
      })
      .catch(fail);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.removeEventListener('wedding-game-ready', ready);
      window.removeEventListener('wedding-game-error', fail);
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const updateOrientation = () => {
      const isProbablyMobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900;
      setIsLandscape(isProbablyMobile && window.innerWidth > window.innerHeight);
    };
    updateOrientation();
    window.addEventListener('resize', updateOrientation);
    window.addEventListener('orientationchange', updateOrientation);
    return () => {
      window.removeEventListener('resize', updateOrientation);
      window.removeEventListener('orientationchange', updateOrientation);
    };
  }, []);

  useEffect(() => {
    // Pause only when the page is genuinely backgrounded or rotated to landscape.
    // NOT on window focus loss: some iOS browsers (Arc) report the visible page as
    // unfocused, and a paused Phaser loop stops processing taps — which made the
    // buttons dead there. `document.hidden` is the reliable "not visible" signal.
    const syncPlayback = () => {
      const controller = controllerRef.current;
      if (!controller || status !== 'ready') return;
      if (document.hidden || isLandscape) controller.pause();
      else controller.resume();
    };

    syncPlayback();
    document.addEventListener('visibilitychange', syncPlayback);
    return () => {
      document.removeEventListener('visibilitychange', syncPlayback);
    };
  }, [isLandscape, status]);

  return (
    <main>
      <section className="game-shell" aria-label="Мини-игра Путь к Кате">
        <div className="game-frame">
          <div className="game-canvas" ref={gameRef} aria-hidden={status !== 'ready'} />
          {status !== 'ready' && (
            <div className="game-fallback" role={status === 'error' ? 'alert' : 'status'}>
              <p className="fallback-title">Путь к Кате</p>
              {status === 'error' ? (
                <>
                  <p className="fallback-copy">Не удалось загрузить игру.</p>
                  <a className="fallback-link" href={LANDING_URL}>
                    Открыть приглашение
                  </a>
                </>
              ) : (
                <p className="fallback-copy">Кая проверяет маршрут...</p>
              )}
            </div>
          )}
          {isLandscape && status === 'ready' && (
            <div className="orientation-overlay" role="status">
              <p className="fallback-title">Поверни телефон вертикально</p>
              <p className="fallback-copy">Так Андрею проще добраться до Кати</p>
            </div>
          )}
        </div>
        <a className="sr-only" href={LANDING_URL}>
          Открыть свадебное приглашение без игры
        </a>
      </section>
    </main>
  );
}
