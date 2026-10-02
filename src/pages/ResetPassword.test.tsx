// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPasswordRecoveryIntent } from '@/lib/passwordRecovery';

const {
  getSessionMock,
  onAuthStateChangeMock,
  updateUserMock,
  signOutMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  updateUserMock: vi.fn(),
  signOutMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

let authCallback: ((event: string, session: unknown) => void) | null = null;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
      updateUser: updateUserMock,
      signOut: signOutMock,
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

import ResetPassword from '@/pages/ResetPassword';

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ResetPassword', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.useRealTimers();
    clearPasswordRecoveryIntent();
    authCallback = null;

    onAuthStateChangeMock.mockImplementation((callback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('does not unlock the reset form for an ordinary authenticated session', async () => {
    vi.useFakeTimers();
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/reset-password']}>
          <Routes>
            <Route path="/reset-password" element={<ResetPassword />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Validando link de recuperação');
    expect(container.querySelector('form')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(container.textContent).toContain('Link de recuperação inválido');
    expect(container.querySelector('form')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('unlocks only after PASSWORD_RECOVERY and releases loading if updateUser throws', async () => {
    updateUserMock.mockRejectedValue(new Error('network unavailable'));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/reset-password']}>
          <Routes>
            <Route path="/reset-password" element={<ResetPassword />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(container.querySelector('form')).toBeNull();

    await act(async () => {
      authCallback?.('PASSWORD_RECOVERY', { user: { id: 'user-1' } });
    });

    const form = container.querySelector('form');
    expect(form).toBeTruthy();

    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="password"]');
    expect(inputs).toHaveLength(2);

    await act(async () => {
      setInputValue(inputs[0], '12345678');
      setInputValue(inputs[1], '12345678');
    });

    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const submitButton = form!.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(updateUserMock).toHaveBeenCalledWith({ password: '12345678' });
    expect(submitButton?.disabled).toBe(false);
    expect(submitButton?.textContent).toContain('Salvar nova senha');
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível atualizar a senha agora. Tente novamente.');

    await act(async () => root.unmount());
    container.remove();
  });

  it('falls back to local sign-out after a successful password update', async () => {
    updateUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    signOutMock
      .mockResolvedValueOnce({ error: new Error('global sign-out unavailable') })
      .mockResolvedValueOnce({ error: null });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/reset-password']}>
          <Routes>
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/auth" element={<div>AUTH DESTINATION</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      authCallback?.('PASSWORD_RECOVERY', { user: { id: 'user-1' } });
    });

    const form = container.querySelector('form')!;
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="password"]');

    await act(async () => {
      setInputValue(inputs[0], 'abcdefgh');
      setInputValue(inputs[1], 'abcdefgh');
    });

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(signOutMock).toHaveBeenNthCalledWith(1);
    expect(signOutMock).toHaveBeenNthCalledWith(2, { scope: 'local' });
    expect(container.textContent).toContain('AUTH DESTINATION');
    expect(toastSuccessMock).toHaveBeenCalledWith('Senha atualizada com sucesso!');

    await act(async () => root.unmount());
    container.remove();
  });
});
