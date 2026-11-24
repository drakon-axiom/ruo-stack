/** One run at a time per process; stopping prevents scheduling after an in-flight run. */
export function startPeriodicWorker(run: () => Promise<void>, intervalMs: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try { await run(); }
    finally {
      if (!stopped) {
        timer = setTimeout(() => { void tick(); }, intervalMs);
        timer.unref?.();
      }
    }
  };
  // Callers handle/report failures inside run, before the next run is scheduled.
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}
