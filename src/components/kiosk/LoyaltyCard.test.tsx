// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  afterEach(async () => {
    if (container?.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
    vi.useRealTimers();
  });

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


describe('LoyaltyCard reward redemption', () => {
  let root: Root;
  let container: HTMLDivElement;
  let redeemHandler: any;
  let customerState: Record<string, unknown>;

  const validRedeemResult = (overrides: Record<string, unknown> = {}) => ({
    ok: true,
    redemption_id: '11111111-1111-4111-8111-111111111111',
    code: 'FID-A1B2C3D4',
    balance: 20,
    points_spent: 10,
    reward: {
      id: 'reward-1',
      title: 'Batata grátis',
      description: '',
      image_url: '',
    },
    ...overrides,
  });

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

  const buttonWithText = (text: string) =>
    Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes(text),
    ) as HTMLButtonElement | undefined;

  const openCatalog = async () => {
    const button = buttonWithText('Ver recompensas');
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await flushAsync();
    });
  };

  const clickRedeem = async () => {
    const button = buttonWithText('Resgatar');
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await flushAsync();
    });
  };

  afterEach(async () => {
    if (container?.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

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

    customerState = validState({
      points_balance: 30,
      points_earned_total: 30,
      points_spent_total: 0,
      catalog: ACTIVE_CONFIG.rewards,
    });
    redeemHandler = vi.fn().mockResolvedValue({
      data: validRedeemResult(),
      error: null,
    });

    rpcMock.mockImplementation((name: string) => {
      if (name === 'loyalty_redeem_reward') return redeemHandler();
      if (name === 'loyalty_customer_state') {
        return Promise.resolve({ data: customerState, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('accepts a complete authoritative redemption and refreshes the wallet afterwards', async () => {
    await renderCard();
    await openCatalog();

    customerState = validState({
      points_balance: 20,
      points_earned_total: 30,
      points_spent_total: 10,
      catalog: ACTIVE_CONFIG.rewards,
    });

    await clickRedeem();

    expect(redeemHandler).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Prêmio reservado');
    expect(container.textContent).toContain('FID-A1B2C3D4');
    expect(container.textContent).toContain('−10 pontos');
    expect(container.textContent).toContain('20');
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('disables redemption while the RPC is pending', async () => {
    const pending = deferred<any>();
    redeemHandler.mockImplementation(() => pending.promise);

    await renderCard();
    await openCatalog();

    const button = buttonWithText('Resgatar');
    expect(button).toBeTruthy();

    await act(async () => {
      button!.click();
      await Promise.resolve();
    });

    expect(buttonWithText('Resgatando…')).toBeDisabled();

    await act(async () => {
      pending.resolve({ data: validRedeemResult(), error: null });
      await flushAsync();
    });
  });

  it('does not turn two same-turn clicks into two redemption RPC calls', async () => {
    const pending = deferred<any>();
    redeemHandler.mockImplementation(() => pending.promise);

    await renderCard();
    await openCatalog();

    const button = buttonWithText('Resgatar');
    expect(button).toBeTruthy();

    await act(async () => {
      button!.click();
      button!.click();
      await Promise.resolve();
    });

    expect(redeemHandler).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ data: validRedeemResult(), error: null });
      await flushAsync();
    });
  });

  it('ignores a redemption response from organization A after switching to organization B', async () => {
    const pending = deferred<any>();
    redeemHandler.mockImplementation(() => pending.promise);

    await renderCard('org-a');
    await openCatalog();

    const button = buttonWithText('Resgatar');
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });

    customerState = validState({
      points_balance: 40,
      points_earned_total: 40,
      points_spent_total: 0,
      catalog: ACTIVE_CONFIG.rewards,
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/loja/b']}>
          <LoyaltyCard organizationId="org-b" />
        </MemoryRouter>,
      );
      await flushAsync();
    });

    expect(container.textContent).toContain('40');

    await act(async () => {
      pending.resolve({
        data: validRedeemResult({
          code: 'FID-OLD0A000',
          reward: {
            id: 'reward-1',
            title: 'Prêmio antigo da organização A',
            description: '',
            image_url: '',
          },
        }),
        error: null,
      });
      await flushAsync();
    });

    expect(container.textContent).not.toContain('Prêmio antigo da organização A');
    expect(container.textContent).not.toContain('FID-OLD0A000');
    expect(container.textContent).toContain('40');
  });

  it('does not expose a PostgREST error message to the customer', async () => {
    redeemHandler.mockResolvedValue({
      data: null,
      error: { message: 'duplicate key value violates internal_constraint' },
    });

    await renderCard();
    await openCatalog();
    await clickRedeem();

    expect(window.alert).toHaveBeenCalledWith('Não foi possível resgatar agora.');
    expect(container.textContent).not.toContain('Prêmio reservado');
  });

  it('does not expose a rejected transport error message to the customer', async () => {
    redeemHandler.mockRejectedValue(new Error('fetch failed at internal gateway'));

    await renderCard();
    await openCatalog();
    await clickRedeem();

    expect(window.alert).toHaveBeenCalledWith('Não foi possível resgatar agora.');
    expect(container.textContent).not.toContain('Prêmio reservado');
  });

  it('requires redemption ok to be the boolean true', async () => {
    redeemHandler.mockResolvedValue({
      data: validRedeemResult({ ok: 'true' }),
      error: null,
    });

    await renderCard();
    await openCatalog();
    await clickRedeem();

    expect(container.textContent).not.toContain('Prêmio reservado');
    expect(window.alert).toHaveBeenCalledWith('Não foi possível resgatar agora.');
  });

  it('fails closed when ok=true omits the redemption contract', async () => {
    redeemHandler.mockResolvedValue({
      data: { ok: true },
      error: null,
    });

    await renderCard();
    await openCatalog();
    await clickRedeem();

    expect(container.textContent).not.toContain('Prêmio reservado');
    expect(window.alert).toHaveBeenCalledWith('Não foi possível resgatar agora.');
  });

  it('rejects an invalid redemption_id instead of opening a false prize', async () => {
    redeemHandler.mockResolvedValue({
      data: validRedeemResult({ redemption_id: 'not-a-uuid' }),
      error: null,
    });

    await renderCard();
    await openCatalog();
    await clickRedeem();

    expect(container.textContent).not.toContain('Prêmio reservado');
    expect(window.alert).toHaveBeenCalledWith('Não foi possível resgatar agora.');
  });

  it('rejects an empty redemption code instead of opening a false prize', async () => {
    redeemHandler.mockResolvedValue({
      data: validRedeemResult({ code: '   ' }),
      error: null,
    });

    await renderCard();
    await openCatalog();
    await clickRedeem();

    expect(container.textContent).not.toContain('Prêmio reservado');
    expect(window.alert).toHaveBeenCalledWith('Não foi possível resgatar agora.');
  });

  it('rejects a malformed reward object instead of falling back to local catalog data', async () => {
    redeemHandler.mockResolvedValue({
      data: validRedeemResult({ reward: { title: 'Batata grátis' } }),
      error: null,
    });

    await renderCard();
    await openCatalog();
    await clickRedeem();

    expect(container.textContent).not.toContain('Prêmio reservado');
    expect(window.alert).toHaveBeenCalledWith('Não foi possível resgatar agora.');
  });

  it.each([
    ['numeric string', '10'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -10],
  ])('rejects malformed points_spent: %s', async (_label, pointsSpent) => {
    redeemHandler.mockResolvedValue({
      data: validRedeemResult({ points_spent: pointsSpent }),
      error: null,
    });

    await renderCard();
    await openCatalog();
    await clickRedeem();

    expect(container.textContent).not.toContain('Prêmio reservado');
    expect(window.alert).toHaveBeenCalledWith('Não foi possível resgatar agora.');
  });

  it('requires an authoritative non-negative integer balance in the success payload', async () => {
    redeemHandler.mockResolvedValue({
      data: validRedeemResult({ balance: '20' }),
      error: null,
    });

    await renderCard();
    await openCatalog();
    await clickRedeem();

    expect(container.textContent).not.toContain('Prêmio reservado');
    expect(window.alert).toHaveBeenCalledWith('Não foi possível resgatar agora.');
  });

  it('maps a known server reason to a customer-safe message', async () => {
    redeemHandler.mockResolvedValue({
      data: { ok: false, reason: 'reward_not_found' },
      error: null,
    });

    await renderCard();
    await openCatalog();
    await clickRedeem();

    expect(window.alert).toHaveBeenCalledWith('Este prêmio não está mais disponível.');
    expect(container.textContent).not.toContain('Prêmio reservado');
  });

  it('fails an unknown server reason closed with the generic customer message', async () => {
    redeemHandler.mockResolvedValue({
      data: { ok: false, reason: 'unexpected_internal_reason' },
      error: null,
    });

    await renderCard();
    await openCatalog();
    await clickRedeem();

    expect(window.alert).toHaveBeenCalledWith('Não foi possível resgatar agora.');
    expect(container.textContent).not.toContain('Prêmio reservado');
  });

  it('trusts the server when the rendered balance became insufficient before redemption', async () => {
    redeemHandler.mockResolvedValue({
      data: {
        ok: false,
        reason: 'insufficient_points',
        balance: 2,
        required: 10,
      },
      error: null,
    });

    await renderCard();
    await openCatalog();
    await clickRedeem();

    expect(window.alert).toHaveBeenCalledWith(
      'Seu saldo mudou e não há pontos suficientes para este prêmio.',
    );
    expect(container.textContent).not.toContain('Prêmio reservado');
  });
});
