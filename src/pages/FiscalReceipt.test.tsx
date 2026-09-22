// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

vi.mock('@/data/store', () => ({
  formatCurrency: (value: number) => `R$ ${Number(value).toFixed(2)}`,
}));

import FiscalReceipt from '@/pages/FiscalReceipt';

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function renderReceipt(root: Root) {
  root.render(
    <MemoryRouter initialEntries={['/fiscal/11111111-1111-1111-1111-111111111111']}>
      <Routes>
        <Route path="/fiscal/:orderId" element={<FiscalReceipt />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('FiscalReceipt', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('shows a recoverable connection error instead of claiming the receipt does not exist', async () => {
    rpcMock.mockRejectedValue(new Error('network unavailable'));

    await act(async () => {
      renderReceipt(root);
      await flushAsync();
    });

    expect(container.textContent).toContain('Não foi possível carregar o comprovante');
    expect(container.textContent).toContain('Tentar novamente');
    expect(container.textContent).not.toContain('Comprovante não encontrado');
    expect(container.textContent).not.toContain('Carregando comprovante');

    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps unauthenticated distinct and provides the authenticated return path', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: false, reason: 'unauthenticated' },
      error: null,
    });

    await act(async () => {
      renderReceipt(root);
      await flushAsync();
    });

    expect(container.textContent).toContain('Entre na sua conta para acessar este comprovante.');
    const loginLink = container.querySelector<HTMLAnchorElement>('a[href^="/auth?returnTo="]');
    expect(loginLink).toBeTruthy();
    expect(loginLink?.getAttribute('href')).toContain('%2Ffiscal%2F11111111-1111-1111-1111-111111111111');

    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps the internal receipt explicitly non-fiscal', async () => {
    rpcMock.mockResolvedValue({
      data: {
        ok: true,
        order: {
          id: '11111111-1111-1111-1111-111111111111',
          order_number: '42',
          created_at: '2026-09-22T12:00:00.000Z',
          customer_name: 'Cliente',
          customer_cpf: '',
          total: 25,
          items: [{ quantity: 1, name: 'Produto', total: 25 }],
          payment_method: 'pix',
          organization_id: '22222222-2222-2222-2222-222222222222',
        },
        store: {
          store_name: 'Loja Teste',
          fiscal_cnpj: '',
          fiscal_razao: '',
        },
      },
      error: null,
    });

    await act(async () => {
      renderReceipt(root);
      await flushAsync();
    });

    expect(container.textContent).toContain('COMPROVANTE DO PEDIDO');
    expect(container.textContent).toContain('Documento não fiscal');
    expect(container.textContent).toContain('Este comprovante não substitui documento fiscal autorizado.');

    await act(async () => root.unmount());
    container.remove();
  });
});
