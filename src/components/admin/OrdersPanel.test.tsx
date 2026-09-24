// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fromMock,
  rpcMock,
  channelMock,
  removeChannelMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
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

vi.mock('@/data/store', () => ({
  formatCurrency: (value: number) => `R$ ${Number(value).toFixed(2)}`,
}));

vi.mock('./OrderPrintReceipt', () => ({
  default: () => null,
}));

vi.mock('@/components/FeatureGate', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useOrderAlertSound', () => ({
  useOrderAlertSound: () => ({
    needsUnlock: false,
    muted: false,
    setMuted: vi.fn(),
    unlock: vi.fn(),
  }),
}));

vi.mock('@/components/LiveDeliveryMap', () => ({
  default: () => null,
}));

vi.mock('@/lib/cep', () => ({
  geocodeAddress: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/deliveryRouting', () => ({
  MAX_EXACT_DESTINATION_ACCURACY_M: 100,
}));

import OrdersPanel from './OrdersPanel';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function resolvedQuery(result: unknown) {
  const q: any = {};
  for (const method of ['select', 'eq', 'order', 'in', 'not', 'gte', 'lte']) {
    q[method] = vi.fn(() => q);
  }
  q.maybeSingle = vi.fn(() => Promise.resolve(result));
  q.limit = vi.fn(() => Promise.resolve(result));
  q.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return q;
}

function makeOrder(orderNumber: string, customerName: string) {
  return {
    id: `order-${orderNumber}`,
    order_number: orderNumber,
    customer_name: customerName,
    customer_phone: '62999999999',
    order_type: 'local',
    delivery_address: null,
    delivery_reference: null,
    delivery_recipient: null,
    items: [],
    total: 25,
    status: 'pending',
    created_at: '2026-09-24T12:00:00.000Z',
    scheduled_for: null,
    payment_status: 'paid',
    table_id: null,
    table_session_id: null,
    table_label: null,
  };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('OrdersPanel fetchOrders lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let orderRequests: Array<{ organizationId: string; deferred: Deferred<any> }>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    orderRequests = [];

    channelMock.mockImplementation(() => {
      const ch: any = {};
      ch.on = vi.fn(() => ch);
      ch.subscribe = vi.fn(() => ch);
      return ch;
    });

    rpcMock.mockResolvedValue({ data: [], error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === 'orders') {
        let organizationId = '';
        const q: any = {};
        q.select = vi.fn(() => q);
        q.eq = vi.fn((column: string, value: string) => {
          if (column === 'organization_id') organizationId = value;
          return q;
        });
        q.order = vi.fn(() => q);
        q.in = vi.fn(() => q);
        q.not = vi.fn(() => q);
        q.gte = vi.fn(() => q);
        q.lte = vi.fn(() => q);
        q.limit = vi.fn(() => {
          const request = deferred<any>();
          orderRequests.push({ organizationId, deferred: request });
          return request.promise;
        });
        return q;
      }

      if (table === 'settings') {
        return resolvedQuery({
          data: {
            store_name: 'Loja',
            scheduling_preparation_lead_min: 30,
            delivery_assignment_mode: 'manual',
          },
          error: null,
        });
      }

      return resolvedQuery({ data: [], error: null });
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('does not let an older organization response overwrite the current organization orders', async () => {
    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });

    expect(orderRequests).toHaveLength(1);
    expect(orderRequests[0].organizationId).toBe('org-a');

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-b" />);
      await flushAsync();
    });

    expect(orderRequests).toHaveLength(2);
    expect(orderRequests[1].organizationId).toBe('org-b');

    await act(async () => {
      orderRequests[1].deferred.resolve({
        data: [makeOrder('B-200', 'Cliente B')],
        error: null,
      });
      await flushAsync();
    });

    expect(container.textContent).toContain('#B-200');
    expect(container.textContent).toContain('Cliente B');

    await act(async () => {
      orderRequests[0].deferred.resolve({
        data: [makeOrder('A-100', 'Cliente A')],
        error: null,
      });
      await flushAsync();
    });

    expect(container.textContent).toContain('#B-200');
    expect(container.textContent).toContain('Cliente B');
    expect(container.textContent).not.toContain('#A-100');
    expect(container.textContent).not.toContain('Cliente A');
  });
});
