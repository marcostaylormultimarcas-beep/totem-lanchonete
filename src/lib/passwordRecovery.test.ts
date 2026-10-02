// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  capturePasswordRecoveryIntentFromUrl,
  clearPasswordRecoveryIntent,
  hasPasswordRecoveryIntent,
} from '@/lib/passwordRecovery';

describe('passwordRecovery intent', () => {
  beforeEach(() => {
    clearPasswordRecoveryIntent();
    window.history.replaceState({}, '', '/reset-password');
  });

  it('captures an implicit Supabase recovery URL before auth consumes it', () => {
    window.history.replaceState(
      {},
      '',
      '/reset-password#access_token=recovery-token&refresh_token=refresh-token&type=recovery',
    );

    expect(capturePasswordRecoveryIntentFromUrl()).toBe(true);
    expect(hasPasswordRecoveryIntent()).toBe(true);
  });

  it('does not trust type=recovery without an implicit-flow access token', () => {
    window.history.replaceState({}, '', '/reset-password#type=recovery');

    expect(capturePasswordRecoveryIntentFromUrl()).toBe(false);
    expect(hasPasswordRecoveryIntent()).toBe(false);
  });
});
