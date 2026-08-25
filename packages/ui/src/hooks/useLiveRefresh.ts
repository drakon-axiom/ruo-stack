import { useEffect, useRef } from 'react';

export const DATA_REFRESHED_EVENT = 'ruostack:data-refreshed';

/** Refresh operational data while the app is visible, and immediately when a
 * user returns. Requests never overlap and pause automatically while offline. */
export function useLiveRefresh(refresh: () => void | Promise<void>, intervalMs = 12_000) {
  const latest = useRef(refresh);
  const running = useRef(false);

  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);

  useEffect(() => {
    async function run() {
      if (running.current || document.visibilityState === 'hidden' || !navigator.onLine) return;
      running.current = true;
      try {
        await latest.current();
        window.dispatchEvent(new CustomEvent(DATA_REFRESHED_EVENT, { detail: Date.now() }));
      } catch {
        // Background refresh failures should never interrupt the current view;
        // the next focus, reconnect, or interval will try again.
      } finally {
        running.current = false;
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    const timer = window.setInterval(() => void run(), intervalMs);
    window.addEventListener('focus', run);
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', run);
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
}

