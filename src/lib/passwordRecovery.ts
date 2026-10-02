const PASSWORD_RECOVERY_STORAGE_KEY = 'visionfood_password_recovery_active';

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function capturePasswordRecoveryIntentFromUrl(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const isImplicitRecovery =
      hashParams.get('type') === 'recovery'
      && hashParams.has('access_token');

    if (!isImplicitRecovery) return false;

    markPasswordRecoveryIntent();
    return true;
  } catch {
    return false;
  }
}

export function markPasswordRecoveryIntent(): void {
  try {
    getSessionStorage()?.setItem(PASSWORD_RECOVERY_STORAGE_KEY, '1');
  } catch {
    // O evento PASSWORD_RECOVERY ainda pode liberar a tela nesta navegação.
  }
}

export function hasPasswordRecoveryIntent(): boolean {
  try {
    return getSessionStorage()?.getItem(PASSWORD_RECOVERY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearPasswordRecoveryIntent(): void {
  try {
    getSessionStorage()?.removeItem(PASSWORD_RECOVERY_STORAGE_KEY);
  } catch {
    // A sessão do Supabase continua sendo a autoridade.
  }
}
