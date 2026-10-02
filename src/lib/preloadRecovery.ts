export const VITE_PRELOAD_RELOAD_KEY = 'vf_vite_preload_reload_at';
export const VITE_PRELOAD_RELOAD_WINDOW_MS = 30_000;

export const shouldReloadAfterPreloadError = (
  lastReloadAt: string | null,
  nowMs: number,
  windowMs = VITE_PRELOAD_RELOAD_WINDOW_MS,
): boolean => {
  if (!lastReloadAt) return true;
  const parsed = Number(lastReloadAt);
  if (!Number.isFinite(parsed) || parsed <= 0) return true;
  return nowMs - parsed > windowMs;
};
