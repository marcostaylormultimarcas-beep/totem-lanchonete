// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  rpcMock,
  channelMock,
  removeChannelMock,
} = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  channelMock: vi.fn(),
  removeChannelMock: vi.fn(),
}));

let realtimeCallback: (() => void) | null = null;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: rpcMock,
    channel: channelMock,
    removeChannel: removeChannelMock,
  },
}));

import OrderTracking from '@/components/kiosk/OrderTracking';

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
}

describe('OrderTracking', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.useRealTimers();
    realtimeCallback = null;

    channelMock.mockImplementation(() => {
      const channel = {
        on: vi.fn(),
        subscribe: vi.fn(),
      };
      channel.on.mockImplementation((_event, _config, callback) => {
        realtimeCallback = callback;
        return channel;
      });
      channel.subscribe.mockReturnValue(channel);
      return channel;
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('shows a recoverable connection error instead of pretending the order does not exist', async () => {
    rpcMock.mockRejectedValue(new Error('network unavailable'));

    await act(async () => {
      root.render(<OrderTracking orderId="11111111-1111-1111-1111-111111111111" onClose={vi.fn()} />);
      await flushAsync();
    });

    expect(container.textContent).toContain('Não foi possível acompanhar o pedido');
    expect(container.textContent).toContain('Tentar novamente');
    expect(container.textContent).not.toContain('Pedido não encontrado');
    expect(container.textContent).not.toContain('Carregando andamento do pedido');

    await act(async () => root.unmount());
    container.remove();
  });

  it('ignores an older background response that arrives after a newer status', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ok: true,
        status: 'preparing',
        order_number: '42',
        order_type: 'viagem',
        scheduled_for: null,
      },
      error: null,
    });

    await act(async () => {
      root.render(<OrderTracking orderId="11111111-1111-1111-1111-111111111111" onClose={vi.fn()} />);
      await flushAsync();
    });

    expect(container.textContent).toContain('Acompanhe seu Pedido');
    expect(realtimeCallback).toBeTypeOf('function');

    const older = deferred<any>();
    const newer = deferred<any>();
    rpcMock
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    await act(async () => {
      realtimeCallback?.();
      realtimeCallback?.();
      await Promise.resolve();
    });

    await act(async () => {
      newer.resolve({
        data: {
          ok: true,
          status: 'delivered',
          order_number: '42',
          order_type: 'viagem',
          scheduled_for: null,
        },
        error: null,
      });
      await flushAsync();
    });

    expect(container.textContent).toContain('Pedido Entregue! Voltar');

    await act(async () => {
      older.resolve({
        data: {
          ok: true,
          status: 'ready',
          order_number: '42',
          order_type: 'viagem',
          scheduled_for: null,
        },
        error: null,
      });
      await flushAsync();
    });

    expect(container.textContent).toContain('Pedido Entregue! Voltar');

    await act(async () => root.unmount());
    container.remove();
  });
});
