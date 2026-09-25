// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fromMock,
  rpcMock,
  redeemRpcMock,
  channelMock,
  removeChannelMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  redeemRpcMock: vi.fn(),
  channelMock: vi.fn(),
  removeChannelMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    channel: channelMock,
    removeChannel: removeChannelMock,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock('@/lib/imageUpload', () => ({
  uploadProductImage: vi.fn(),
  StorageLimitError: class StorageLimitError extends Error {},
}));

vi.mock('@/data/store', () => ({
  formatCurrency: (value: number) => `R$ ${Number(value).toFixed(2)}`,
}));

import LoyaltyPanel from './LoyaltyPanel';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type RedemptionRow = {
  id: string;
  organization_id: string;
  telefone_cliente: string;
  premio_texto: string;
  premio_descricao: string;
  premio_imagem: string;
  codigo_resgate: string;
  points_spent: number;
  status: 'pendente' | 'utilizado';
  created_at: string;
  used_at: string | null;
};

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REDEMPTION_A = '11111111-1111-4111-8111-111111111111';
const REDEMPTION_B = '22222222-2222-4222-8222-222222222222';
const OTHER_REDEMPTION = '33333333-3333-4333-8333-333333333333';

function deferred<T>(): Deferred<T> {
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

function redemption(
  id: string,
  organizationId: string,
  title: string,
  code: string,
): RedemptionRow {
  return {
    id,
    organization_id: organizationId,
    telefone_cliente: '62999999999',
    premio_texto: title,
    premio_descricao: '',
    premio_imagem: '',
    codigo_resgate: code,
    points_spent: 10,
    status: 'pendente',
    created_at: '2026-09-25T08:00:00.000Z',
    used_at: null,
  };
}

describe('LoyaltyPanel prize consumption', () => {
  let root: Root;
  let container: HTMLDivElement;
  let redemptionsByOrg: Record<string, RedemptionRow[]>;
  let loadCalls: Array<{ table: string; organizationId: string }>;

  const tableResult = (table: string, organizationId: string) => {
    loadCalls.push({ table, organizationId });

    if (table === 'config_fidelidade') {
      return {
        data: {
          id: `config-${organizationId}`,
          ativo: true,
          earning_mode: 'order',
          points_per_real: 1,
          points_per_order: 1,
          valor_minimo_pedido: 0,
          data_inicio: null,
          data_fim: null,
        },
        error: null,
      };
    }

    if (table === 'resgates_fidelidade') {
      return { data: redemptionsByOrg[organizationId] || [], error: null };
    }

    return { data: [], error: null };
  };

  const makeQuery = (table: string) => {
    let organizationId = '';
    const q: any = {};

    q.select = vi.fn(() => q);
    q.eq = vi.fn((column: string, value: unknown) => {
      if (column === 'organization_id') organizationId = String(value);
      return q;
    });
    q.order = vi.fn(() => q);
    q.limit = vi.fn(() => Promise.resolve(tableResult(table, organizationId)));
    q.maybeSingle = vi.fn(() => Promise.resolve(tableResult(table, organizationId)));
    q.then = (resolve: any, reject: any) =>
      Promise.resolve(tableResult(table, organizationId)).then(resolve, reject);

    return q;
  };

  const renderPanel = async (organizationId: string) => {
    await act(async () => {
      root.render(<LoyaltyPanel organizationId={organizationId} />);
      await flushAsync();
    });
  };

  const deliverButton = () => {
    const button = Array.from(container.querySelectorAll('button'))
      .find(item => item.textContent?.includes('Entreguei'));
    if (!button) throw new Error('Deliver button not found');
    return button as HTMLButtonElement;
  };

  const clickDeliver = async () => {
    await act(async () => {
      deliverButton().click();
      await flushAsync();
    });
  };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();

    redemptionsByOrg = {
      [ORG_A]: [redemption(REDEMPTION_A, ORG_A, 'Prêmio A', 'FID-A1')],
      [ORG_B]: [redemption(REDEMPTION_B, ORG_B, 'Prêmio B', 'FID-B1')],
    };
    loadCalls = [];

    fromMock.mockImplementation((table: string) => makeQuery(table));

    rpcMock.mockImplementation((name: string, args: unknown) => {
      if (name === 'loyalty_admin_summary') {
        return Promise.resolve({
          data: {
            ok: true,
            active_customers: 0,
            points_issued: 0,
            points_reversed: 0,
            points_spent: 0,
            outstanding_points: 0,
            pending_rewards: 1,
          },
          error: null,
        });
      }
      if (name === 'redeem_loyalty_prize') {
        return redeemRpcMock(args);
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    channelMock.mockImplementation(() => {
      const channel: any = {};
      channel.on = vi.fn(() => channel);
      channel.subscribe = vi.fn(() => channel);
      return channel;
    });
    removeChannelMock.mockResolvedValue(null);

    redeemRpcMock.mockResolvedValue({
      data: { ok: true, id: REDEMPTION_A },
      error: null,
    });

    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: vi.fn(() => true),
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (container?.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('accepts only the authoritative success for the redemption that was requested', async () => {
    await renderPanel(ORG_A);
    await clickDeliver();

    expect(redeemRpcMock).toHaveBeenCalledTimes(1);
    expect(redeemRpcMock).toHaveBeenCalledWith({ _resgate_id: REDEMPTION_A });
    expect(toastSuccessMock).toHaveBeenCalledWith('Prêmio marcado como utilizado.');
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('does not dispatch a second RPC when the same delivery button is clicked again while pending', async () => {
    const request = deferred<any>();
    redeemRpcMock.mockReturnValue(request.promise);

    await renderPanel(ORG_A);

    await act(async () => {
      const button = deliverButton();
      button.click();
      button.click();
      await Promise.resolve();
    });

    expect(redeemRpcMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.resolve({ data: { ok: true, id: REDEMPTION_A }, error: null });
      await flushAsync();
    });
  });

  it('keeps PostgREST technical errors out of the operator message', async () => {
    redeemRpcMock.mockResolvedValue({
      data: null,
      error: { message: 'postgres detail: sensitive internal text' },
    });

    await renderPanel(ORG_A);
    await clickDeliver();

    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível concluir a entrega do prêmio.');
    expect(String(toastErrorMock.mock.calls.at(-1)?.[0])).not.toContain('sensitive internal text');
  });

  it('keeps rejected Promise details out of the operator message', async () => {
    redeemRpcMock.mockRejectedValue(new Error('network stack internal detail'));

    await renderPanel(ORG_A);
    await clickDeliver();

    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível concluir a entrega do prêmio.');
    expect(String(toastErrorMock.mock.calls.at(-1)?.[0])).not.toContain('network stack internal detail');
  });

  it('requires ok to be the boolean true', async () => {
    redeemRpcMock.mockResolvedValue({
      data: { ok: 'true', id: REDEMPTION_A },
      error: null,
    });

    await renderPanel(ORG_A);
    await clickDeliver();

    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível concluir a entrega do prêmio.');
  });

  it('rejects an incomplete success payload with no authoritative redemption id', async () => {
    redeemRpcMock.mockResolvedValue({
      data: { ok: true },
      error: null,
    });

    await renderPanel(ORG_A);
    await clickDeliver();

    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível concluir a entrega do prêmio.');
  });

  it('rejects a success payload for a different redemption id', async () => {
    redeemRpcMock.mockResolvedValue({
      data: { ok: true, id: OTHER_REDEMPTION },
      error: null,
    });

    await renderPanel(ORG_A);
    await clickDeliver();

    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível concluir a entrega do prêmio.');
  });

  it('does not let an old organization redemption response show success or refetch the old organization', async () => {
    const request = deferred<any>();
    redeemRpcMock.mockReturnValue(request.promise);

    await renderPanel(ORG_A);

    await act(async () => {
      deliverButton().click();
      await Promise.resolve();
    });

    await renderPanel(ORG_B);
    expect(container.textContent).toContain('Prêmio B');
    expect(container.textContent).not.toContain('Prêmio A');

    const orgALoadsBefore = loadCalls.filter(
      call => call.table === 'resgates_fidelidade' && call.organizationId === ORG_A,
    ).length;

    await act(async () => {
      request.resolve({ data: { ok: true, id: REDEMPTION_A }, error: null });
      await flushAsync();
    });

    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Prêmio B');
    expect(container.textContent).not.toContain('Prêmio A');

    const orgALoadsAfter = loadCalls.filter(
      call => call.table === 'resgates_fidelidade' && call.organizationId === ORG_A,
    ).length;
    expect(orgALoadsAfter).toBe(orgALoadsBefore);
  });

  it('does not let an old post-success reconciliation overwrite a newer organization', async () => {
    const oldRefresh = deferred<any>();
    const newRefresh = deferred<any>();
    let orgARedemptionLoads = 0;

    fromMock.mockImplementation((table: string) => {
      if (table !== 'resgates_fidelidade') return makeQuery(table);

      let organizationId = '';
      const q: any = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn((column: string, value: unknown) => {
        if (column === 'organization_id') organizationId = String(value);
        return q;
      });
      q.order = vi.fn(() => q);
      q.limit = vi.fn(() => {
        loadCalls.push({ table, organizationId });

        if (organizationId === ORG_A) {
          orgARedemptionLoads += 1;
          if (orgARedemptionLoads === 2) return oldRefresh.promise;
        }

        if (organizationId === ORG_B) return newRefresh.promise;
        return Promise.resolve(tableResult(table, organizationId));
      });
      return q;
    });

    await renderPanel(ORG_A);

    await act(async () => {
      deliverButton().click();
      await flushAsync();
    });

    await act(async () => {
      root.render(<LoyaltyPanel organizationId={ORG_B} />);
      await flushAsync();
      await new Promise(resolve => setTimeout(resolve, 0));
      await flushAsync();
    });

    await act(async () => {
      newRefresh.resolve({ data: redemptionsByOrg[ORG_B], error: null });
      await newRefresh.promise;
      await flushAsync();
      await new Promise(resolve => setTimeout(resolve, 0));
      await flushAsync();
    });

    expect(container.textContent).toContain('Prêmio B');
    expect(container.textContent).not.toContain('Prêmio A');

    await act(async () => {
      oldRefresh.resolve({ data: redemptionsByOrg[ORG_A], error: null });
      await flushAsync();
    });

    expect(container.textContent).toContain('Prêmio B');
    expect(container.textContent).not.toContain('Prêmio A');
  });

  it('does not show a success after the panel unmounts while redemption is pending', async () => {
    const request = deferred<any>();
    redeemRpcMock.mockReturnValue(request.promise);

    await renderPanel(ORG_A);

    await act(async () => {
      deliverButton().click();
      await Promise.resolve();
      root.unmount();
    });
    container.remove();

    await act(async () => {
      request.resolve({ data: { ok: true, id: REDEMPTION_A }, error: null });
      await flushAsync();
    });

    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('fails closed for both known and unknown server reasons without leaking the raw reason', async () => {
    await renderPanel(ORG_A);

    redeemRpcMock.mockResolvedValueOnce({
      data: { ok: false, reason: 'already_used' },
      error: null,
    });
    await clickDeliver();

    expect(toastErrorMock).toHaveBeenLastCalledWith('Não foi possível concluir a entrega do prêmio.');
    expect(String(toastErrorMock.mock.calls.at(-1)?.[0])).not.toContain('already_used');

    redeemRpcMock.mockResolvedValueOnce({
      data: { ok: false, reason: 'internal_rule_name_that_must_not_leak' },
      error: null,
    });
    await clickDeliver();

    expect(toastErrorMock).toHaveBeenLastCalledWith('Não foi possível concluir a entrega do prêmio.');
    expect(String(toastErrorMock.mock.calls.at(-1)?.[0])).not.toContain('internal_rule_name_that_must_not_leak');
  });
});


describe('LoyaltyPanel loyalty campaign configuration', () => {
  let root: Root;
  let container: HTMLDivElement;
  let configsByOrg: Record<string, any>;
  let configReadResolver: (organizationId: string) => Promise<any>;
  let saveConfigMock: ReturnType<typeof vi.fn>;

  const tableResult = (table: string, organizationId: string) => {
    if (table === 'resgates_fidelidade') return { data: [], error: null };
    return { data: [], error: null };
  };

  const makeQuery = (table: string) => {
    let organizationId = '';
    const q: any = {};

    q.select = vi.fn(() => q);
    q.eq = vi.fn((column: string, value: unknown) => {
      if (column === 'organization_id') organizationId = String(value);
      return q;
    });
    q.order = vi.fn(() => q);
    q.limit = vi.fn(() => Promise.resolve(tableResult(table, organizationId)));
    q.maybeSingle = vi.fn(() => {
      if (table === 'config_fidelidade') return configReadResolver(organizationId);
      return Promise.resolve(tableResult(table, organizationId));
    });
    q.upsert = vi.fn((payload: any, options: any) => {
      const result = saveConfigMock(payload, options);
      const writeQ: any = {};
      writeQ.select = vi.fn(() => writeQ);
      writeQ.maybeSingle = vi.fn(() => result);
      return writeQ;
    });
    q.then = (resolve: any, reject: any) =>
      Promise.resolve(tableResult(table, organizationId)).then(resolve, reject);

    return q;
  };

  const configRow = (
    organizationId: string,
    pointsPerOrder: number,
    minimum = 0,
    start: string | null = null,
    end: string | null = null,
  ) => ({
    id: 'config-' + organizationId,
    organization_id: organizationId,
    ativo: true,
    earning_mode: 'order',
    points_per_real: 1,
    points_per_order: pointsPerOrder,
    valor_minimo_pedido: minimum,
    data_inicio: start,
    data_fim: end,
  });

  const renderPanel = async (organizationId: string) => {
    await act(async () => {
      root.render(<LoyaltyPanel organizationId={organizationId} />);
      await flushAsync();
    });
  };

  const findButton = (text: string) => {
    const button = Array.from(container.querySelectorAll('button'))
      .find(item => item.textContent?.includes(text));
    if (!button) throw new Error('Button not found: ' + text);
    return button as HTMLButtonElement;
  };

  const openEditor = async () => {
    await act(async () => {
      findButton('Editar programa').click();
      await flushAsync();
    });
  };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();

    configsByOrg = {
      [ORG_A]: configRow(
        ORG_A,
        7,
        25,
        '2026-09-20T00:00:00.000Z',
        '2026-10-20T23:59:59.999Z',
      ),
      [ORG_B]: configRow(ORG_B, 19),
    };

    configReadResolver = (organizationId: string) =>
      Promise.resolve({ data: configsByOrg[organizationId] || null, error: null });

    saveConfigMock = vi.fn().mockResolvedValue({
      data: { id: 'config-' + ORG_A },
      error: null,
    });

    fromMock.mockImplementation((table: string) => makeQuery(table));

    rpcMock.mockImplementation((name: string) => {
      if (name === 'loyalty_admin_summary') {
        return Promise.resolve({
          data: {
            ok: true,
            active_customers: 0,
            points_issued: 0,
            points_reversed: 0,
            points_spent: 0,
            outstanding_points: 0,
            pending_rewards: 0,
          },
          error: null,
        });
      }
      throw new Error('Unexpected RPC: ' + name);
    });

    channelMock.mockImplementation(() => {
      const channel: any = {};
      channel.on = vi.fn(() => channel);
      channel.subscribe = vi.fn(() => channel);
      return channel;
    });
    removeChannelMock.mockResolvedValue(null);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (container?.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('writes the live campaign columns with organization_id as the upsert conflict key', async () => {
    await renderPanel(ORG_A);
    await openEditor();

    await act(async () => {
      findButton('Salvar alterações').click();
      await flushAsync();
    });

    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    expect(saveConfigMock).toHaveBeenCalledWith(
      {
        organization_id: ORG_A,
        ativo: true,
        earning_mode: 'order',
        points_per_real: 1,
        points_per_order: 7,
        valor_minimo_pedido: 25,
        data_inicio: '2026-09-20T00:00:00.000Z',
        data_fim: '2026-10-20T23:59:59.999Z',
      },
      { onConflict: 'organization_id' },
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('Programa de pontos salvo e atualizado.');
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('does not let an older organization bootstrap overwrite the newer campaign', async () => {
    const loadA = deferred<any>();
    const loadB = deferred<any>();

    configReadResolver = (organizationId: string) =>
      organizationId === ORG_A ? loadA.promise : loadB.promise;

    await renderPanel(ORG_A);

    await act(async () => {
      root.render(<LoyaltyPanel organizationId={ORG_B} />);
      await flushAsync();
    });

    await act(async () => {
      loadB.resolve({ data: configsByOrg[ORG_B], error: null });
      await flushAsync();
    });

    expect(container.textContent).toContain('19 pontos por pedido elegível');
    expect(container.textContent).not.toContain('7 pontos por pedido elegível');

    await act(async () => {
      loadA.resolve({ data: configsByOrg[ORG_A], error: null });
      await flushAsync();
    });

    expect(container.textContent).toContain('19 pontos por pedido elegível');
    expect(container.textContent).not.toContain('7 pontos por pedido elegível');
  });

  it('does not let a save from the previous organization show success or overwrite the newer campaign', async () => {
    const saveA = deferred<any>();
    saveConfigMock.mockReturnValue(saveA.promise);

    await renderPanel(ORG_A);
    await openEditor();

    await act(async () => {
      findButton('Salvar alterações').click();
      await Promise.resolve();
    });

    await renderPanel(ORG_B);
    expect(container.textContent).toContain('19 pontos por pedido elegível');
    toastSuccessMock.mockClear();

    await act(async () => {
      saveA.resolve({ data: { id: 'config-' + ORG_A }, error: null });
      await flushAsync();
    });

    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('19 pontos por pedido elegível');
    expect(container.textContent).not.toContain('7 pontos por pedido elegível');
  });

  it('does not dispatch two campaign upserts from two save events in the same turn', async () => {
    const saveA = deferred<any>();
    saveConfigMock.mockReturnValue(saveA.promise);

    await renderPanel(ORG_A);
    await openEditor();

    await act(async () => {
      const button = findButton('Salvar alterações');
      button.click();
      button.click();
      await Promise.resolve();
    });

    expect(saveConfigMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      saveA.resolve({ data: { id: 'config-' + ORG_A }, error: null });
      await flushAsync();
    });
  });

  it('does not show campaign save success after the panel unmounts', async () => {
    const saveA = deferred<any>();
    saveConfigMock.mockReturnValue(saveA.promise);

    await renderPanel(ORG_A);
    await openEditor();

    await act(async () => {
      findButton('Salvar alterações').click();
      await Promise.resolve();
      root.unmount();
    });
    container.remove();

    await act(async () => {
      saveA.resolve({ data: { id: 'config-' + ORG_A }, error: null });
      await flushAsync();
    });

    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
