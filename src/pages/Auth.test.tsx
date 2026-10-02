// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchPublicOrganizationMock,
  getSessionMock,
  onAuthStateChangeMock,
  signInWithPasswordMock,
  signUpMock,
  setSessionMock,
  resetPasswordForEmailMock,
  signInWithOAuthMock,
  rpcMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  fetchPublicOrganizationMock: vi.fn(),
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  signInWithPasswordMock: vi.fn(),
  signUpMock: vi.fn(),
  setSessionMock: vi.fn(),
  resetPasswordForEmailMock: vi.fn(),
  signInWithOAuthMock: vi.fn(),
  rpcMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
      signInWithPassword: signInWithPasswordMock,
      signUp: signUpMock,
      setSession: setSessionMock,
      resetPasswordForEmail: resetPasswordForEmailMock,
      signInWithOAuth: signInWithOAuthMock,
    },
    rpc: rpcMock,
  },
}));

vi.mock('@/lib/publicOrganization', () => ({
  fetchPublicOrganization: fetchPublicOrganizationMock,
}));

vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({
    orgId: null,
    org: { slug: 'loja-teste' },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: vi.fn(),
  },
}));

import Auth from '@/pages/Auth';

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Auth', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    onAuthStateChangeMock.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('releases loading when storefront organization resolution fails during signup', async () => {
    fetchPublicOrganizationMock.mockRejectedValue(new Error('network unavailable'));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/auth?returnTo=%2Fcardapio%2Floja-teste']}>
          <Routes>
            <Route path="/auth" element={<Auth />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const signupModeButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Cadastre-se'));
    expect(signupModeButton).toBeTruthy();

    await act(async () => {
      signupModeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const nameInput = container.querySelector<HTMLInputElement>('input[placeholder="Seu nome completo"]');
    const emailInput = container.querySelector<HTMLInputElement>('input[type="email"]');
    const passwordInput = container.querySelector<HTMLInputElement>('input[type="password"]');
    expect(nameInput).toBeTruthy();
    expect(emailInput).toBeTruthy();
    expect(passwordInput).toBeTruthy();

    await act(async () => {
      setInputValue(nameInput!, 'Cliente Teste');
      setInputValue(emailInput!, 'cliente@example.com');
      setInputValue(passwordInput!, '123456');
    });

    const form = container.querySelector('form');
    expect(form).toBeTruthy();

    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const submitButton = form!.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(fetchPublicOrganizationMock).toHaveBeenCalledWith({ slug: 'loja-teste' });
    expect(submitButton?.disabled).toBe(false);
    expect(submitButton?.textContent).toContain('Criar Conta');
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível criar a conta agora. Tente novamente.');

    await act(async () => root.unmount());
    container.remove();
  });
});
