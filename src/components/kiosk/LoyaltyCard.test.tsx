// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSessionMock,
  rpcMock,
  fetchPublicLoyaltyConfigMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  rpcMock: vi.fn(),
  fetchPublicLoyaltyConfigMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
    rpc: rpcMock,
  },
}));

vi.mock('@/lib/publicLoyaltyConfig', () => ({
  fetchPublicLoyaltyConfig: fetchPublicLoyaltyConfigMock,
}));

vi.mock('@/data/store', () => ({
  formatCurrency: (value: number) => `R$ ${Number(value).toFixed(2)}`,
}));

import LoyaltyCard from '@/components/kiosk/LoyaltyCard';

const ACTIVE_CONFIG = {
  ativo: true,
  earning_mode: 'order' as const,
  points_per_real: 1,
  points_per_order: 1,
  valor_minimo_pedido: 0,
  meta_pedidos: 10,
  premio_recompensa: '',
  descricao_premio: '',
  premio_imagem: '',
  rewards: [
    {
      id: 'reward-1',
      title: 'Batata grátis',
      description: '',
      image_url: '',
      points_cost: 10,
      reward_type: 'benefit' as const,
      product_id: null,
    },
  ],
};

const validState = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  phone: '62999999999',
  config: {
    ativo: true,
    earning_mode: 'order',
    points_per_real: 1,
    points_per_order: 1,
    valor_minimo_pedido: 0,
    meta_pedidos: 10,
  },
  points_balance: 12,
  points_earned_total: 20,
  points_spent_total: 8,
  catalog: [],
  redemptions: [],
  history: [],
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('LoyaltyCard customer wallet read', () => {
  let root: Root;
  let container: HTMLDivElement;

  const renderCard = async (organizationId: string | null = 'org-a') => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/loja/demo']}>
          <LoyaltyCard organizationId={organizationId} />
        </MemoryRouter>,
      );
      await flushAsync();
    });
  };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.useRealTimers();
    localStorage.clear();

    fetchPublicLoyaltyConfigMock.mockResolvedValue(ACTIVE_CONFIG);
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });
    rpcMock.mockResolvedValue({
      data: validState(),
      error: null,
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('shows the sign-in state without querying a wallet for an unauthenticated client', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await renderCard();

    expect(container.textContent).toContain('Entrar para ver meus pontos');
    expect(rpcMock).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it('renders a valid authenticated wallet without coercing its contract', async () => {
    await renderCard();

    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain('20 pts');
    expect(container.textContent).toContain('8 pts');
    expect(container.textContent).not.toContain('Não foi possível carregar sua fidelidade');

    await act(async () => root.unmount());
    container.remove();
  });

  it('distinguishes a first-load PostgREST error from a real zero-point wallet', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'database unavailable' },
    });

    await renderCard();

    expect(container.textContent).toContain('Não foi possível carregar sua fidelidade');
    expect(container.textContent).not.toContain('Mostrando a última informação disponível');

    await act(async () => root.unmount());
    container.remove();
  });

  it('distinguishes a first-load rejected request from a real zero-point wallet', async () => {
    rpcMock.mockRejectedValue(new Error('network unavailable'));

    await renderCard();

    expect(container.textContent).toContain('Não foi possível carregar sua fidelidade');
    expect(container.textContent).not.toContain('Mostrando a última informação disponível');

    await act(async () => root.unmount());
    container.remove();
  });

  it('fails closed when an ok payload omits the wallet contract', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true },
      error: null,
    });

    await renderCard();

    expect(container.textContent).toContain('Não foi possível carregar sua fidelidade');

    await act(async () => root.unmount());
    container.remove();
  });

  it('requires ok to be the boolean true', async () => {
    rpcMock.mockResolvedValue({
      data: validState({ ok: 'true', points_balance: 77 }),
      error: null,
    });

    await renderCard();

    expect(container.textContent).toContain('Não foi possível carregar sua fidelidade');
    expect(container.textContent).not.toContain('77');

    await act(async () => root.unmount());
    container.remove();
  });

  it('does not coerce numeric strings into wallet totals', async () => {
    rpcMock.mockResolvedValue({
      data: validState({
        points_balance: '15',
        points_earned_total: '30',
        points_spent_total: '15',
      }),
      error: null,
    });

    await renderCard();

    expect(container.textContent).toContain('Não foi possível carregar sua fidelidade');
    expect(container.textContent).not.toContain('30 pts');

    await act(async () => root.unmount());
    container.remove();
  });

  it.each([
    ['negative balance', { points_balance: -1 }],
    ['negative earned total', { points_earned_total: -1 }],
    ['negative spent total', { points_spent_total: -1 }],
    ['infinite balance', { points_balance: Number.POSITIVE_INFINITY }],
    ['NaN balance', { points_balance: Number.NaN }],
  ])('rejects malformed wallet totals: %s', async (_label, override) => {
    rpcMock.mockResolvedValue({
      data: validState(override),
      error: null,
    });

    await renderCard();

    expect(container.textContent).toContain('Não foi possível carregar sua fidelidade');

    await act(async () => root.unmount());
    container.remove();
  });

  it('rejects malformed ledger values instead of displaying coerced history', async () => {
    rpcMock.mockResolvedValue({
      data: validState({
        history: [
          {
            id: 'ledger-1',
            entry_type: 'earn',
            points: '4',
            balance_after: 12,
            eligible_amount: 25,
            description: 'Pedido entregue',
            created_at: '2026-09-25T01:00:00.000Z',
          },
        ],
      }),
      error: null,
    });

    await renderCard();

    expect(container.textContent).toContain('Não foi possível carregar sua fidelidade');

    await act(async () => root.unmount());
    container.remove();
  });

  it('ignores a response from organization A after switching to organization B', async () => {
    const orgA = deferred<any>();

    rpcMock
      .mockImplementationOnce(() => orgA.promise)
      .mockResolvedValueOnce({
        data: validState({ points_balance: 22, points_earned_total: 22, points_spent_total: 0 }),
        error: null,
      });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/loja/a']}>
          <LoyaltyCard organizationId="org-a" />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/loja/b']}>
          <LoyaltyCard organizationId="org-b" />
        </MemoryRouter>,
      );
      await flushAsync();
    });

    expect(container.textContent).toContain('22');

    await act(async () => {
      orgA.resolve({
        data: validState({
          points_balance: 99,
          points_earned_total: 99,
          points_spent_total: 0,
          redemptions: [
            {
              id: 'old-org-prize',
              reward_id: 'reward-1',
              premio_texto: 'Prêmio da organização A',
              premio_descricao: '',
              premio_imagem: '',
              codigo_resgate: 'OLD-A',
              points_spent: 10,
              status: 'pendente',
              created_at: '2026-09-25T01:00:00.000Z',
              used_at: null,
            },
          ],
        }),
        error: null,
      });
      await flushAsync();
    });

    expect(container.textContent).toContain('22');
    expect(container.textContent).not.toContain('99');
    expect(container.textContent).not.toContain('Prêmio da organização A');

    await act(async () => root.unmount());
    container.remove();
  });

  it('does not let an older same-organization refetch overwrite a newer wallet snapshot', async () => {
    rpcMock.mockResolvedValueOnce({
      data: validState({ points_balance: 10, points_earned_total: 10, points_spent_total: 0 }),
      error: null,
    });

    await renderCard();
    expect(container.textContent).toContain('10');

    const older = deferred<any>();
    const newer = deferred<any>();
    rpcMock
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });

    await act(async () => {
      newer.resolve({
        data: validState({ points_balance: 30, points_earned_total: 30, points_spent_total: 0 }),
        error: null,
      });
      await flushAsync();
    });
    expect(container.textContent).toContain('30');

    await act(async () => {
      older.resolve({
        data: validState({ points_balance: 20, points_earned_total: 20, points_spent_total: 0 }),
        error: null,
      });
      await flushAsync();
    });

    expect(container.textContent).toContain('30');
    expect(container.textContent).not.toContain('20 pts');

    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps the last successful wallet visible when a background refetch fails', async () => {
    rpcMock.mockResolvedValueOnce({
      data: validState({ points_balance: 14, points_earned_total: 20, points_spent_total: 6 }),
      error: null,
    });

    await renderCard();
    expect(container.textContent).toContain('14');

    rpcMock.mockRejectedValueOnce(new Error('network unavailable'));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await flushAsync();
    });

    expect(container.textContent).toContain('14');
    expect(container.textContent).toContain('Mostrando a última informação disponível');

    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps inactive loyalty distinct from loading and error states', async () => {
    fetchPublicLoyaltyConfigMock.mockResolvedValue(null);

    await renderCard();

    expect(container.textContent).toBe('');

    await act(async () => root.unmount());
    container.remove();
  });

  it('shows a real empty wallet as zero points only after a valid contract', async () => {
    rpcMock.mockResolvedValue({
      data: validState({
        phone: '',
        points_balance: 0,
        points_earned_total: 0,
        points_spent_total: 0,
        catalog: [],
        redemptions: [],
        history: [],
      }),
      error: null,
    });

    await renderCard();

    expect(container.textContent).toContain('Faça um pedido elegível');
    expect(container.textContent).not.toContain('Não foi possível carregar sua fidelidade');

    await act(async () => root.unmount());
    container.remove();
  });
});
