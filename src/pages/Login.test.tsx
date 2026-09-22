// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSessionMock,
  onAuthStateChangeMock,
  signInWithPasswordMock,
  resetPasswordForEmailMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  signInWithPasswordMock: vi.fn(),
  resetPasswordForEmailMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
      signInWithPassword: signInWithPasswordMock,
      resetPasswordForEmail: resetPasswordForEmailMock,
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: vi.fn(),
  },
}));

import Login from '@/pages/Login';

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Login', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    onAuthStateChangeMock.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('normalizes email and releases loading when password login throws', async () => {
    signInWithPasswordMock.mockRejectedValue(new Error('network unavailable'));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/gerencia-vision-x']}>
          <Routes>
            <Route path="/gerencia-vision-x" element={<Login />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const emailInput = container.querySelector<HTMLInputElement>('input[type="email"]');
    const passwordInput = container.querySelector<HTMLInputElement>('input[type="password"]');
    const form = container.querySelector('form');
    expect(emailInput).toBeTruthy();
    expect(passwordInput).toBeTruthy();
    expect(form).toBeTruthy();

    await act(async () => {
      setInputValue(emailInput!, '  ADMIN@EXAMPLE.COM  ');
      setInputValue(passwordInput!, '123456');
    });

    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: '123456',
    });

    const submitButton = form!.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submitButton?.disabled).toBe(false);
    expect(submitButton?.textContent).toContain('Entrar no Sistema');
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível entrar agora. Tente novamente.');

    await act(async () => root.unmount());
    container.remove();
  });

  it('has no orphan recovery PIN and releases forgot loading on request failure', async () => {
    resetPasswordForEmailMock.mockRejectedValue(new Error('network unavailable'));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/gerencia-vision-x']}>
          <Routes>
            <Route path="/gerencia-vision-x" element={<Login />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('PIN de Recuperação');

    const forgotButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Esqueci minha senha'));
    expect(forgotButton).toBeTruthy();

    await act(async () => {
      forgotButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).not.toContain('PIN de Recuperação');

    const modalEmail = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="email"]'))
      .find(input => input.closest('.fixed'));
    expect(modalEmail).toBeTruthy();

    await act(async () => {
      setInputValue(modalEmail!, '  ADMIN@EXAMPLE.COM  ');
    });

    const modalForm = modalEmail!.closest('form');
    expect(modalForm).toBeTruthy();

    await act(async () => {
      modalForm!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(resetPasswordForEmailMock).toHaveBeenCalledWith(
      'admin@example.com',
      { redirectTo: `${window.location.origin}/reset-password` },
    );

    const submitButton = modalForm!.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submitButton?.disabled).toBe(false);
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível enviar o link agora. Tente novamente.');

    await act(async () => root.unmount());
    container.remove();
  });
});
