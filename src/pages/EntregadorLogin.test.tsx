// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  rpcMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

import EntregadorLogin, {
  clearEntregadorSession,
  getEntregadorSession,
} from '@/pages/EntregadorLogin';

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function renderLogin(root: Root, initialEntry = '/entregador/login/loja-a') {
  root.render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/entregador/login/:slug" element={<EntregadorLogin />} />
        <Route path="/entregador/login" element={<EntregadorLogin />} />
        <Route path="/entregador" element={<div>DRIVER DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EntregadorLogin', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('releases loading and shows a recoverable message when the login request rejects', async () => {
    rpcMock.mockRejectedValue(new Error('network unavailable'));

    await act(async () => {
      renderLogin(root);
      await flushAsync();
    });

    const inputs = container.querySelectorAll<HTMLInputElement>('input');
    await act(async () => {
      setInputValue(inputs[1], 'motorista');
      setInputValue(inputs[2], 'senha-segura');
    });

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushAsync();
    });

    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(false);
    expect(submit?.textContent).toContain('Entrar');
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível entrar agora. Verifique a conexão e tente novamente.');

    await act(async () => root.unmount());
    container.remove();
  });

  it('revokes the issued server session and does not navigate when browser storage is blocked', async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: {
          ok: true,
          entregador: {
            id: '11111111-1111-1111-1111-111111111111',
            name: 'Motorista',
            username: 'motorista',
            organization_id: '22222222-2222-2222-2222-222222222222',
            org_slug: 'loja-a',
            org_name: 'Loja A',
          },
          session_token: 'a'.repeat(64),
          expires_at: '2099-01-01T00:00:00.000Z',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    await act(async () => {
      renderLogin(root);
      await flushAsync();
    });

    const inputs = container.querySelectorAll<HTMLInputElement>('input');
    await act(async () => {
      setInputValue(inputs[1], 'motorista');
      setInputValue(inputs[2], 'senha-segura');
    });

    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushAsync();
    });

    expect(rpcMock).toHaveBeenNthCalledWith(2, 'entregador_logout_session', {
      _session_token: 'a'.repeat(64),
    });
    expect(container.textContent).not.toContain('DRIVER DASHBOARD');
    expect(toastErrorMock).toHaveBeenCalledWith(
      'O navegador bloqueou o armazenamento da sessão. Libere o armazenamento do site e tente novamente.',
    );

    setItemSpy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  });

  it('does not reuse a stored session from another store slug', async () => {
    localStorage.setItem('entregador_session', JSON.stringify({
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Motorista',
      username: 'motorista',
      organization_id: '22222222-2222-2222-2222-222222222222',
      org_slug: 'loja-a',
      org_name: 'Loja A',
      session_token: 'b'.repeat(64),
      expires_at: '2099-01-01T00:00:00.000Z',
    }));

    await act(async () => {
      renderLogin(root, '/entregador/login/loja-b');
      await flushAsync();
    });

    expect(container.textContent).toContain('Acesso do Entregador');
    expect(container.textContent).not.toContain('DRIVER DASHBOARD');
    expect(localStorage.getItem('entregador_session')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it('returns null instead of throwing when browser storage cannot be read', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(getEntregadorSession()).toBeNull();
    expect(() => clearEntregadorSession()).not.toThrow();

    getItemSpy.mockRestore();
    removeItemSpy.mockRestore();
  });
});
