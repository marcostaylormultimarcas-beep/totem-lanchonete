import { describe, expect, it } from 'vitest';
import {
  shouldReloadAfterPreloadError,
  VITE_PRELOAD_RELOAD_WINDOW_MS,
} from './preloadRecovery';

describe('preloadRecovery', () => {
  it('allows the first recovery reload', () => {
    expect(shouldReloadAfterPreloadError(null, 1_000)).toBe(true);
  });

  it('blocks a reload loop inside the recovery window', () => {
    expect(shouldReloadAfterPreloadError('1000', 1_000 + VITE_PRELOAD_RELOAD_WINDOW_MS)).toBe(false);
  });

  it('allows recovery again after the window', () => {
    expect(shouldReloadAfterPreloadError('1000', 1_001 + VITE_PRELOAD_RELOAD_WINDOW_MS)).toBe(true);
  });

  it('treats invalid stored timestamps as recoverable', () => {
    expect(shouldReloadAfterPreloadError('invalid', 5_000)).toBe(true);
  });
});
