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
  default: ({ storeName }: { storeName: string }) => <div data-testid="receipt-store-name">{storeName}</div>,
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

function makeDeliveryOrder(orderNumber: string, customerName: string, productId = 'prod-b') {
  return {
    ...makeOrder(orderNumber, customerName),
    order_type: 'delivery',
    status: 'ready',
    delivery_address: 'Rua Teste, 100',
    items: [{ product_id: productId, name: 'Produto teste', quantity: 1, total: 25 }],
  };
}

function makeBootstrapQuery(
  table: string,
  requests: Record<string, Array<{ organizationId: string; deferred: Deferred<any> }>>,
  orderData: (organizationId: string) => any[] = () => [],
) {
  let organizationId = '';
  const q: any = {};
  q.select = vi.fn(() => q);
  q.eq = vi.fn((column: string, value: string) => {
    if (column === 'organization_id') organizationId = value;
    return q;
  });
  for (const method of ['order', 'in', 'not', 'gte', 'lte']) q[method] = vi.fn(() => q);
  q.maybeSingle = vi.fn(() => {
    const request = deferred<any>();
    requests[table].push({ organizationId, deferred: request });
    return request.promise;
  });
  q.limit = vi.fn(() => Promise.resolve({ data: orderData(organizationId), error: null }));
  q.then = (resolve: any, reject: any) => {
    const request = deferred<any>();
    requests[table].push({ organizationId, deferred: request });
    return request.promise.then(resolve, reject);
  };
  return q;
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


describe('OrdersPanel organization bootstrap lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let requests: Record<string, Array<{ organizationId: string; deferred: Deferred<any> }>>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    requests = { settings: [], entregadores: [], products: [] };

    channelMock.mockImplementation(() => {
      const ch: any = {};
      ch.on = vi.fn(() => ch);
      ch.subscribe = vi.fn(() => ch);
      return ch;
    });

    rpcMock.mockResolvedValue({ data: [], error: null });

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

  it('does not let stale settings from the previous organization overwrite the current store bootstrap', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'orders') return makeBootstrapQuery(table, { ...requests, orders: [] } as any, () => []);
      if (table === 'settings') return makeBootstrapQuery(table, requests);
      return resolvedQuery({ data: [], error: null });
    });

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });
    await act(async () => {
      root.render(<OrdersPanel organizationId="org-b" />);
      await flushAsync();
    });

    expect(requests.settings.map(r => r.organizationId)).toEqual(['org-a', 'org-b']);

    await act(async () => {
      requests.settings[1].deferred.resolve({
        data: {
          store_name: 'Loja B',
          scheduling_preparation_lead_min: 45,
          delivery_assignment_mode: 'manual',
        },
        error: null,
      });
      await flushAsync();
    });
    expect(container.querySelector('[data-testid="receipt-store-name"]')?.textContent).toBe('Loja B');

    await act(async () => {
      requests.settings[0].deferred.resolve({
        data: {
          store_name: 'Loja A',
          scheduling_preparation_lead_min: 10,
          delivery_assignment_mode: 'free',
        },
        error: null,
      });
      await flushAsync();
    });

    expect(container.querySelector('[data-testid="receipt-store-name"]')?.textContent).toBe('Loja B');
  });

  it('does not let stale entregadores from the previous organization overwrite the current organization list', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'orders') {
        const holder = { ...requests, orders: [] } as any;
        return makeBootstrapQuery(table, holder, organizationId =>
          organizationId === 'org-b' ? [makeDeliveryOrder('B-200', 'Cliente B')] : [],
        );
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
      if (table === 'entregadores') return makeBootstrapQuery(table, requests);
      return resolvedQuery({ data: [], error: null });
    });

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });
    await act(async () => {
      root.render(<OrdersPanel organizationId="org-b" />);
      await flushAsync();
    });

    expect(requests.entregadores.map(r => r.organizationId)).toEqual(['org-a', 'org-b']);

    await act(async () => {
      requests.entregadores[1].deferred.resolve({
        data: [{ id: 'driver-b', name: 'Entregador B', active: true }],
        error: null,
      });
      await flushAsync();
    });
    expect(container.textContent).toContain('Entregador B');

    await act(async () => {
      requests.entregadores[0].deferred.resolve({
        data: [{ id: 'driver-a', name: 'Entregador A', active: true }],
        error: null,
      });
      await flushAsync();
    });

    expect(container.textContent).toContain('Entregador B');
    expect(container.textContent).not.toContain('Entregador A');
  });

  it('does not let stale low-stock products from the previous organization overwrite lowStockIds', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'orders') {
        const holder = { ...requests, orders: [] } as any;
        return makeBootstrapQuery(table, holder, organizationId =>
          organizationId === 'org-b' ? [makeDeliveryOrder('B-200', 'Cliente B', 'prod-b')] : [],
        );
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
      if (table === 'products') return makeBootstrapQuery(table, requests);
      return resolvedQuery({ data: [], error: null });
    });

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });
    await act(async () => {
      root.render(<OrdersPanel organizationId="org-b" />);
      await flushAsync();
    });

    expect(requests.products.map(r => r.organizationId)).toEqual(['org-a', 'org-b']);

    await act(async () => {
      requests.products[1].deferred.resolve({ data: [{ id: 'prod-b' }], error: null });
      await flushAsync();
    });

    const filtersButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('Filtros'),
    );
    expect(filtersButton).toBeTruthy();
    await act(async () => {
      filtersButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    await act(async () => {
      checkbox!.click();
      await flushAsync();
    });
    expect(container.textContent).toContain('#B-200');

    await act(async () => {
      requests.products[0].deferred.resolve({ data: [{ id: 'prod-a' }], error: null });
      await flushAsync();
    });

    expect(container.textContent).toContain('#B-200');
  });

  it('clears bootstrap state from the previous organization while the new organization is still loading', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'orders') {
        const holder = { ...requests, orders: [] } as any;
        return makeBootstrapQuery(table, holder, organizationId => [
          makeDeliveryOrder(organizationId === 'org-a' ? 'A-100' : 'B-200', organizationId === 'org-a' ? 'Cliente A' : 'Cliente B'),
        ]);
      }
      if (table === 'settings' || table === 'entregadores') return makeBootstrapQuery(table, requests);
      return resolvedQuery({ data: [], error: null });
    });

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });
    await act(async () => {
      requests.settings[0].deferred.resolve({
        data: {
          store_name: 'Loja A',
          scheduling_preparation_lead_min: 30,
          delivery_assignment_mode: 'manual',
        },
        error: null,
      });
      requests.entregadores[0].deferred.resolve({
        data: [{ id: 'driver-a', name: 'Entregador A', active: true }],
        error: null,
      });
      await flushAsync();
    });

    expect(container.querySelector('[data-testid="receipt-store-name"]')?.textContent).toBe('Loja A');
    expect(container.textContent).toContain('Entregador A');

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-b" />);
      await flushAsync();
    });

    expect(container.querySelector('[data-testid="receipt-store-name"]')?.textContent).toBe('');
    expect(container.textContent).not.toContain('Entregador A');
  });

  it('does not consume bootstrap payloads that resolve after unmount', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'orders') return resolvedQuery({ data: [], error: null });
      if (table === 'settings' || table === 'entregadores' || table === 'products') {
        return makeBootstrapQuery(table, requests);
      }
      return resolvedQuery({ data: [], error: null });
    });

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });

    expect(requests.settings).toHaveLength(1);
    expect(requests.entregadores).toHaveLength(1);
    expect(requests.products).toHaveLength(1);

    await act(async () => {
      root.unmount();
      await flushAsync();
    });
    container.remove();

    let payloadReads = 0;
    const lateResponse: any = { error: null };
    Object.defineProperty(lateResponse, 'data', {
      get() {
        payloadReads += 1;
        return [];
      },
    });

    requests.settings[0].deferred.resolve(lateResponse);
    requests.entregadores[0].deferred.resolve(lateResponse);
    requests.products[0].deferred.resolve(lateResponse);
    await flushAsync();

    expect(payloadReads).toBe(0);
  });

  it('contains bootstrap transport rejections instead of leaving unhandled promise rejections', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'orders') return resolvedQuery({ data: [], error: null });
      if (table === 'settings' || table === 'entregadores' || table === 'products') {
        return makeBootstrapQuery(table, requests);
      }
      return resolvedQuery({ data: [], error: null });
    });

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });

    expect(requests.settings).toHaveLength(1);
    expect(requests.entregadores).toHaveLength(1);
    expect(requests.products).toHaveLength(1);

    await act(async () => {
      requests.settings[0].deferred.reject(new Error('settings network unavailable'));
      requests.entregadores[0].deferred.reject(new Error('drivers network unavailable'));
      requests.products[0].deferred.reject(new Error('products network unavailable'));
      await flushAsync();
    });

    expect(container.querySelector('[data-testid="receipt-store-name"]')?.textContent).toBe('');
  });

});


describe('OrdersPanel filters, table labels, realtime and polling lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let orderRequests: Array<{ organizationId: string; deferred: Deferred<any> }>;
  let tableRequests: Array<{ organizationId: string; deferred: Deferred<any> }>;
  let realtimeHandlers: Array<{ channel: string; callback: () => void }>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    orderRequests = [];
    tableRequests = [];
    realtimeHandlers = [];

    channelMock.mockImplementation((channel: string) => {
      const ch: any = {};
      ch.on = vi.fn((_event: string, _config: unknown, callback: () => void) => {
        realtimeHandlers.push({ channel, callback });
        return ch;
      });
      ch.subscribe = vi.fn(() => ch);
      return ch;
    });

    rpcMock.mockImplementation((fn: string, args?: { _org?: string }) => {
      if (fn === 'visionfood_admin_tables') {
        const request = deferred<any>();
        tableRequests.push({ organizationId: args?._org || '', deferred: request });
        return request.promise;
      }
      return Promise.resolve({ data: [], error: null });
    });

    fromMock.mockImplementation((table: string) => {
      if (table === 'orders') {
        let organizationId = '';
        const q: any = {};
        q.select = vi.fn(() => q);
        q.eq = vi.fn((column: string, value: string) => {
          if (column === 'organization_id') organizationId = value;
          return q;
        });
        for (const method of ['order', 'in', 'not', 'gte', 'lte']) q[method] = vi.fn(() => q);
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
    vi.restoreAllMocks();
  });

  it('clears registered table labels immediately when the organization changes', async () => {
    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });

    expect(tableRequests.map(r => r.organizationId)).toEqual(['org-a']);

    await act(async () => {
      tableRequests[0].deferred.resolve({
        data: [{ label: 'Mesa A', active: true }],
        error: null,
      });
      orderRequests[0].deferred.resolve({ data: [], error: null });
      await flushAsync();
    });

    expect(Array.from(container.querySelectorAll('option')).some(option => option.textContent === 'Mesa A')).toBe(true);

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-b" />);
      await flushAsync();
    });

    expect(tableRequests.map(r => r.organizationId)).toEqual(['org-a', 'org-b']);
    expect(Array.from(container.querySelectorAll('option')).some(option => option.textContent === 'Mesa A')).toBe(false);
  });

  it('contains table-filter transport rejection instead of leaving an unhandled promise rejection', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'visionfood_admin_tables') return Promise.reject(new Error('tables network unavailable'));
      return Promise.resolve({ data: [], error: null });
    });

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });

    expect(container.textContent).toContain('Todas as mesas');
  });

  it('does not let a removed realtime subscription start a stale organization request', async () => {
    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });

    expect(orderRequests.map(r => r.organizationId)).toEqual(['org-a']);
    expect(realtimeHandlers.map(h => h.channel)).toEqual(['admin-orders-org-a']);

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-b" />);
      await flushAsync();
    });

    expect(orderRequests.map(r => r.organizationId)).toEqual(['org-a', 'org-b']);
    expect(realtimeHandlers.map(h => h.channel)).toEqual(['admin-orders-org-a', 'admin-orders-org-b']);

    await act(async () => {
      realtimeHandlers[0].callback();
      await flushAsync();
    });

    expect(orderRequests.map(r => r.organizationId)).toEqual(['org-a', 'org-b']);
  });

  it('does not let a cleared polling callback start a stale organization request', async () => {
    const pollingCallbacks: Array<() => void> = [];
    vi.spyOn(window, 'setInterval').mockImplementation(((callback: TimerHandler) => {
      pollingCallbacks.push(callback as () => void);
      return pollingCallbacks.length as any;
    }) as typeof window.setInterval);
    vi.spyOn(window, 'clearInterval').mockImplementation((() => {}) as typeof window.clearInterval);

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });

    expect(orderRequests.map(r => r.organizationId)).toEqual(['org-a']);
    expect(pollingCallbacks).toHaveLength(1);

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-b" />);
      await flushAsync();
    });

    expect(orderRequests.map(r => r.organizationId)).toEqual(['org-a', 'org-b']);
    expect(pollingCallbacks).toHaveLength(2);

    await act(async () => {
      pollingCallbacks[0]();
      await flushAsync();
    });

    expect(orderRequests.map(r => r.organizationId)).toEqual(['org-a', 'org-b']);
  });

  it('uses local calendar-day boundaries for dateFrom and dateTo', async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/Sao_Paulo';
    const gteCalls: string[] = [];
    const lteCalls: string[] = [];

    try {
      rpcMock.mockResolvedValue({ data: [], error: null });
      fromMock.mockImplementation((table: string) => {
        if (table === 'orders') {
          const q: any = {};
          q.select = vi.fn(() => q);
          q.eq = vi.fn(() => q);
          q.order = vi.fn(() => q);
          q.in = vi.fn(() => q);
          q.not = vi.fn(() => q);
          q.gte = vi.fn((_column: string, value: string) => {
            gteCalls.push(value);
            return q;
          });
          q.lte = vi.fn((_column: string, value: string) => {
            lteCalls.push(value);
            return q;
          });
          q.limit = vi.fn(() => Promise.resolve({ data: [], error: null }));
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

      await act(async () => {
        root.render(<OrdersPanel organizationId="org-a" />);
        await flushAsync();
      });

      const filtersButton = Array.from(container.querySelectorAll('button')).find(
        button => button.textContent?.includes('Filtros'),
      );
      expect(filtersButton).toBeTruthy();

      await act(async () => {
        filtersButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flushAsync();
      });

      const dateInputs = Array.from(container.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
      expect(dateInputs).toHaveLength(2);

      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      expect(valueSetter).toBeTruthy();

      await act(async () => {
        valueSetter!.call(dateInputs[0], '2026-09-24');
        dateInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        await flushAsync();
      });

      await act(async () => {
        valueSetter!.call(dateInputs[1], '2026-09-24');
        dateInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        await flushAsync();
      });

      expect(gteCalls.at(-1)).toBe(new Date(2026, 8, 24, 0, 0, 0, 0).toISOString());
      expect(lteCalls.at(-1)).toBe(new Date(2026, 8, 24, 23, 59, 59, 999).toISOString());
    } finally {
      process.env.TZ = previousTimezone;
    }
  });

});


describe('OrdersPanel assignEntregador lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let orderFetches: string[];
  let assignmentRequest: Deferred<any> | null;
  let assignmentCalls: Array<{ orderId: string; entregadorId: string | null }>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    orderFetches = [];
    assignmentRequest = null;
    assignmentCalls = [];

    channelMock.mockImplementation(() => {
      const ch: any = {};
      ch.on = vi.fn(() => ch);
      ch.subscribe = vi.fn(() => ch);
      return ch;
    });

    rpcMock.mockImplementation((fn: string, args?: any) => {
      if (fn === 'visionfood_admin_tables') return Promise.resolve({ data: [], error: null });
      if (fn === 'assign_entregador') {
        assignmentCalls.push({
          orderId: args?._order_id || '',
          entregadorId: args?._entregador_id ?? null,
        });
        if (assignmentRequest) return assignmentRequest.promise;
        return Promise.resolve({
          data: {
            ok: true,
            order_id: args?._order_id,
            entregador_id: args?._entregador_id ?? null,
            idempotent: false,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    fromMock.mockImplementation((table: string) => {
      if (table === 'orders') {
        let organizationId = '';
        const q: any = {};
        q.select = vi.fn(() => q);
        q.eq = vi.fn((column: string, value: string) => {
          if (column === 'organization_id') organizationId = value;
          return q;
        });
        for (const method of ['order', 'in', 'not', 'gte', 'lte']) q[method] = vi.fn(() => q);
        q.limit = vi.fn(() => {
          orderFetches.push(organizationId);
          return Promise.resolve({
            data: [
              makeDeliveryOrder(
                organizationId === 'org-a' ? 'A-100' : 'B-200',
                organizationId === 'org-a' ? 'Cliente A' : 'Cliente B',
              ),
            ],
            error: null,
          });
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

      if (table === 'entregadores') {
        return resolvedQuery({
          data: [{ id: 'driver-1', name: 'Entregador 1', active: true }],
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

  const findAssignmentSelect = () =>
    Array.from(container.querySelectorAll('select')).find(select =>
      Array.from(select.options).some(option => option.value === 'driver-1'),
    ) as HTMLSelectElement | undefined;

  const changeAssignment = async (value: string) => {
    const select = findAssignmentSelect();
    expect(select).toBeTruthy();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    expect(valueSetter).toBeTruthy();
    await act(async () => {
      valueSetter!.call(select, value);
      select!.dispatchEvent(new Event('change', { bubbles: true }));
      await flushAsync();
    });
  };

  it('contains assign_entregador transport rejection and releases the busy state', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'visionfood_admin_tables') return Promise.resolve({ data: [], error: null });
      if (fn === 'assign_entregador') return Promise.reject(new Error('assign network unavailable'));
      return Promise.resolve({ data: [], error: null });
    });

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });

    await changeAssignment('driver-1');
    await act(async () => {
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith('Falha ao atribuir entregador.');
    expect(findAssignmentSelect()?.disabled).toBe(false);
  });

  it('does not accept malformed success payload from assign_entregador', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'visionfood_admin_tables') return Promise.resolve({ data: [], error: null });
      if (fn === 'assign_entregador') return Promise.resolve({ data: { ok: true }, error: null });
      return Promise.resolve({ data: [], error: null });
    });

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });

    expect(orderFetches).toEqual(['org-a']);
    await changeAssignment('driver-1');

    expect(toastErrorMock).toHaveBeenCalledWith('Falha ao atribuir entregador.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a']);
    expect(findAssignmentSelect()?.disabled).toBe(false);
  });

  it('ignores a pending assignment result after the organization changes', async () => {
    assignmentRequest = deferred<any>();

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });

    expect(orderFetches).toEqual(['org-a']);
    await changeAssignment('driver-1');
    expect(assignmentCalls).toEqual([{ orderId: 'order-A-100', entregadorId: 'driver-1' }]);

    await act(async () => {
      root.render(<OrdersPanel organizationId="org-b" />);
      await flushAsync();
    });

    expect(orderFetches).toEqual(['org-a', 'org-b']);
    expect(container.textContent).toContain('#B-200');

    await act(async () => {
      assignmentRequest!.resolve({
        data: {
          ok: true,
          order_id: 'order-A-100',
          entregador_id: 'driver-1',
          idempotent: false,
        },
        error: null,
      });
      await flushAsync();
    });

    expect(orderFetches).toEqual(['org-a', 'org-b']);
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('#B-200');
    expect(container.textContent).not.toContain('#A-100');
  });
});


describe('OrdersPanel assignEntregador contract and UI modes', () => {
  let root: Root;
  let container: HTMLDivElement;
  let assignmentMode: 'manual' | 'free';
  let currentOrder: any;
  let orderFetches: string[];
  let assignmentCalls: Array<{ _order_id: string; _entregador_id: string | null }>;
  let realtimeCallbacks: Array<() => void>;
  let assignmentResponder: (args: { _order_id: string; _entregador_id: string | null }) => Promise<any>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    assignmentMode = 'manual';
    currentOrder = makeDeliveryOrder('A-100', 'Cliente A');
    orderFetches = [];
    assignmentCalls = [];
    realtimeCallbacks = [];
    assignmentResponder = async args => ({
      data: {
        ok: true,
        order_id: args._order_id,
        entregador_id: args._entregador_id,
        idempotent: false,
      },
      error: null,
    });

    channelMock.mockImplementation((channel: string) => {
      const ch: any = {};
      ch.on = vi.fn((_event: string, _config: unknown, callback: () => void) => {
        if (channel === 'admin-orders-org-a') realtimeCallbacks.push(callback);
        return ch;
      });
      ch.subscribe = vi.fn(() => ch);
      return ch;
    });

    rpcMock.mockImplementation((fn: string, args?: any) => {
      if (fn === 'visionfood_admin_tables') return Promise.resolve({ data: [], error: null });
      if (fn === 'assign_entregador') {
        const payload = {
          _order_id: args?._order_id || '',
          _entregador_id: args?._entregador_id ?? null,
        };
        assignmentCalls.push(payload);
        return assignmentResponder(payload);
      }
      return Promise.resolve({ data: [], error: null });
    });

    fromMock.mockImplementation((table: string) => {
      if (table === 'orders') {
        let organizationId = '';
        const q: any = {};
        q.select = vi.fn(() => q);
        q.eq = vi.fn((column: string, value: string) => {
          if (column === 'organization_id') organizationId = value;
          return q;
        });
        for (const method of ['order', 'in', 'not', 'gte', 'lte']) q[method] = vi.fn(() => q);
        q.limit = vi.fn(() => {
          orderFetches.push(organizationId);
          return Promise.resolve({ data: [currentOrder], error: null });
        });
        return q;
      }

      if (table === 'settings') {
        return resolvedQuery({
          data: {
            store_name: 'Loja',
            scheduling_preparation_lead_min: 30,
            delivery_assignment_mode: assignmentMode,
          },
          error: null,
        });
      }

      if (table === 'entregadores') {
        return resolvedQuery({
          data: [
            { id: 'driver-1', name: 'Entregador 1', active: true },
            { id: 'driver-2', name: 'Entregador 2', active: true },
          ],
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

  const renderPanel = async () => {
    await act(async () => {
      root.render(<OrdersPanel organizationId="org-a" />);
      await flushAsync();
    });
  };

  const findAssignmentSelect = () =>
    Array.from(container.querySelectorAll('select')).find(select =>
      Array.from(select.options).some(option => option.value === 'driver-1'),
    ) as HTMLSelectElement | undefined;

  const changeAssignment = async (value: string) => {
    const select = findAssignmentSelect();
    expect(select).toBeTruthy();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    expect(valueSetter).toBeTruthy();
    await act(async () => {
      valueSetter!.call(select, value);
      select!.dispatchEvent(new Event('change', { bubbles: true }));
      await flushAsync();
    });
  };

  it('sends the canonical payload, blocks a simultaneous second assignment, refetches on success and releases busy state', async () => {
    const request = deferred<any>();
    assignmentResponder = () => request.promise;

    await renderPanel();
    expect(orderFetches).toEqual(['org-a']);

    await changeAssignment('driver-1');

    expect(assignmentCalls).toEqual([
      { _order_id: 'order-A-100', _entregador_id: 'driver-1' },
    ]);
    expect(rpcMock).toHaveBeenCalledWith('assign_entregador', {
      _order_id: 'order-A-100',
      _entregador_id: 'driver-1',
    });
    expect(findAssignmentSelect()?.disabled).toBe(true);

    const select = findAssignmentSelect()!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    await act(async () => {
      valueSetter!.call(select, 'driver-2');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flushAsync();
    });

    expect(assignmentCalls).toHaveLength(1);

    currentOrder = { ...currentOrder, entregador_id: 'driver-1' };
    await act(async () => {
      request.resolve({
        data: {
          ok: true,
          order_id: 'order-A-100',
          entregador_id: 'driver-1',
          idempotent: false,
        },
        error: null,
      });
      await flushAsync();
    });

    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Entregador reservado para o pedido. Ele iniciará a entrega após retirar na loja.',
    );
    expect(orderFetches).toEqual(['org-a', 'org-a']);
    expect(findAssignmentSelect()?.disabled).toBe(false);
    expect(findAssignmentSelect()?.value).toBe('driver-1');
  });

  it('removes a manual assignment with _entregador_id null and refetches the order', async () => {
    currentOrder = { ...currentOrder, entregador_id: 'driver-1' };
    assignmentResponder = async args => {
      currentOrder = { ...currentOrder, entregador_id: null };
      return {
        data: {
          ok: true,
          order_id: args._order_id,
          entregador_id: null,
          idempotent: false,
        },
        error: null,
      };
    };

    await renderPanel();
    expect(findAssignmentSelect()?.value).toBe('driver-1');

    await changeAssignment('');

    expect(assignmentCalls).toEqual([
      { _order_id: 'order-A-100', _entregador_id: null },
    ]);
    expect(toastSuccessMock).toHaveBeenCalledWith('Atribuição removida.');
    expect(orderFetches).toEqual(['org-a', 'org-a']);
    expect(findAssignmentSelect()?.value).toBe('');
  });

  it('keeps an unassigned ready order in free mode out of the manual selector', async () => {
    assignmentMode = 'free';

    await renderPanel();

    expect(findAssignmentSelect()).toBeUndefined();
    expect(container.textContent).toContain('Disputa livre: este pedido está disponível no app dos entregadores.');
    expect(assignmentCalls).toHaveLength(0);
  });

  it('releases an assigned ready order back to free mode through assign_entregador null', async () => {
    assignmentMode = 'free';
    currentOrder = { ...currentOrder, entregador_id: 'driver-1' };
    assignmentResponder = async args => {
      currentOrder = { ...currentOrder, entregador_id: null };
      return {
        data: {
          ok: true,
          order_id: args._order_id,
          entregador_id: null,
          idempotent: false,
        },
        error: null,
      };
    };

    await renderPanel();

    const releaseButton = Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Liberar para outro entregador'),
    );
    expect(releaseButton).toBeTruthy();

    await act(async () => {
      releaseButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });

    expect(assignmentCalls).toEqual([
      { _order_id: 'order-A-100', _entregador_id: null },
    ]);
    expect(toastSuccessMock).toHaveBeenCalledWith('Pedido liberado para os outros entregadores.');
    expect(orderFetches).toEqual(['org-a', 'org-a']);
    expect(container.textContent).toContain('Disputa livre: este pedido está disponível no app dos entregadores.');
  });

  it.each([
    ['delivery_in_progress', 'A entrega já saiu da loja. Use “Devolver à fila” antes de trocar o entregador.'],
    ['status_locked', 'Este pedido não permite mais alterar o entregador.'],
    ['entregador_invalid', 'Entregador inválido ou inativo.'],
    ['forbidden', 'Sem permissão para alterar esta entrega.'],
  ])('maps assign_entregador reason %s and releases busy state', async (reason, message) => {
    assignmentResponder = async () => ({
      data: { ok: false, reason },
      error: null,
    });

    await renderPanel();
    await changeAssignment('driver-1');

    expect(toastErrorMock).toHaveBeenCalledWith(message);
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a']);
    expect(findAssignmentSelect()?.disabled).toBe(false);
  });

  it('fails closed on a Supabase error response and releases busy state', async () => {
    assignmentResponder = async () => ({
      data: null,
      error: { message: 'database unavailable' },
    });

    await renderPanel();
    await changeAssignment('driver-1');

    expect(toastErrorMock).toHaveBeenCalledWith('Falha ao atribuir entregador.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a']);
    expect(findAssignmentSelect()?.disabled).toBe(false);
  });

  it('fails closed on malformed error payload', async () => {
    assignmentResponder = async () => ({
      data: { ok: false, reason: 42 },
      error: null,
    });

    await renderPanel();
    await changeAssignment('driver-1');

    expect(toastErrorMock).toHaveBeenCalledWith('Falha ao atribuir entregador.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a']);
    expect(findAssignmentSelect()?.disabled).toBe(false);
  });

  it('rejects a success payload correlated to another order', async () => {
    assignmentResponder = async () => ({
      data: {
        ok: true,
        order_id: 'order-other',
        entregador_id: 'driver-1',
        idempotent: false,
      },
      error: null,
    });

    await renderPanel();
    await changeAssignment('driver-1');

    expect(toastErrorMock).toHaveBeenCalledWith('Falha ao atribuir entregador.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a']);
    expect(findAssignmentSelect()?.disabled).toBe(false);
  });

  it('handles a server status change while assign_entregador is pending without stale success UI', async () => {
    const request = deferred<any>();
    assignmentResponder = () => request.promise;

    await renderPanel();
    expect(realtimeCallbacks).toHaveLength(1);

    await changeAssignment('driver-1');
    expect(findAssignmentSelect()?.disabled).toBe(true);

    currentOrder = { ...currentOrder, status: 'out_for_delivery', entregador_id: null };
    await act(async () => {
      realtimeCallbacks[0]();
      await flushAsync();
    });

    expect(findAssignmentSelect()).toBeUndefined();
    expect(orderFetches).toEqual(['org-a', 'org-a']);

    await act(async () => {
      request.resolve({
        data: { ok: false, reason: 'delivery_in_progress' },
        error: null,
      });
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      'A entrega já saiu da loja. Use “Devolver à fila” antes de trocar o entregador.',
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a', 'org-a']);

    currentOrder = { ...currentOrder, status: 'ready', entregador_id: null };
    await act(async () => {
      realtimeCallbacks[0]();
      await flushAsync();
    });

    expect(findAssignmentSelect()).toBeTruthy();
    expect(findAssignmentSelect()?.disabled).toBe(false);
  });

  it('blocks two assignment changes dispatched in the same turn while the first RPC is pending', async () => {
    const request = deferred<any>();
    assignmentResponder = () => request.promise;

    await renderPanel();

    const select = findAssignmentSelect();
    expect(select).toBeTruthy();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    expect(valueSetter).toBeTruthy();

    await act(async () => {
      valueSetter!.call(select, 'driver-1');
      select!.dispatchEvent(new Event('change', { bubbles: true }));
      valueSetter!.call(select, 'driver-2');
      select!.dispatchEvent(new Event('change', { bubbles: true }));
      await flushAsync();
    });

    expect(assignmentCalls).toEqual([
      { _order_id: 'order-A-100', _entregador_id: 'driver-1' },
    ]);

    currentOrder = { ...currentOrder, entregador_id: 'driver-1' };
    await act(async () => {
      request.resolve({
        data: {
          ok: true,
          order_id: 'order-A-100',
          entregador_id: 'driver-1',
          idempotent: false,
        },
        error: null,
      });
      await flushAsync();
    });

    expect(orderFetches).toEqual(['org-a', 'org-a']);
    expect(findAssignmentSelect()?.disabled).toBe(false);
  });

});


describe('OrdersPanel returnDeliveryToQueue lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let assignmentMode: 'manual' | 'free';
  let currentOrder: ReturnType<typeof makeDeliveryOrder> & {
    entregador_id?: string | null;
    delivery_issue_reason?: string | null;
    delivery_issue_at?: string | null;
  };
  let orderFetches: string[];
  let returnCalls: Array<{ orderId: string; reason: string }>;
  let returnResponder: (args: { orderId: string; reason: string }) => Promise<any>;
  let realtimeCallbacks: Array<() => void>;
  let promptMock: any;
  let confirmMock: any;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();

    assignmentMode = 'manual';
    currentOrder = {
      ...makeDeliveryOrder('A-100', 'Cliente A'),
      status: 'out_for_delivery',
      entregador_id: 'driver-1',
      delivery_issue_reason: 'Cliente não atendeu',
      delivery_issue_at: '2026-09-24T18:00:00.000Z',
    };
    orderFetches = [];
    returnCalls = [];
    realtimeCallbacks = [];

    promptMock = vi.spyOn(window, 'prompt').mockReturnValue('  retorno confirmado  ');
    confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);

    returnResponder = async ({ orderId }) => {
      currentOrder = {
        ...currentOrder,
        status: 'ready',
        entregador_id: null,
        delivery_issue_reason: null,
        delivery_issue_at: null,
      };
      return {
        data: { ok: true, status: 'ready', returned_to_queue: true },
        error: null,
      };
    };

    channelMock.mockImplementation((channel: string) => {
      const ch: any = {};
      ch.on = vi.fn((_event: string, _config: unknown, callback: () => void) => {
        if (channel === 'admin-orders-org-a') realtimeCallbacks.push(callback);
        return ch;
      });
      ch.subscribe = vi.fn(() => ch);
      return ch;
    });

    rpcMock.mockImplementation((fn: string, args?: any) => {
      if (fn === 'visionfood_admin_tables') return Promise.resolve({ data: [], error: null });
      if (fn === 'visionfood_return_delivery_to_queue') {
        const payload = {
          orderId: args?._order_id || '',
          reason: args?._reason || '',
        };
        returnCalls.push(payload);
        return returnResponder(payload);
      }
      return Promise.resolve({ data: [], error: null });
    });

    fromMock.mockImplementation((table: string) => {
      if (table === 'orders') {
        let organizationId = '';
        const q: any = {};
        q.select = vi.fn(() => q);
        q.eq = vi.fn((column: string, value: string) => {
          if (column === 'organization_id') organizationId = value;
          return q;
        });
        for (const method of ['order', 'in', 'not', 'gte', 'lte']) q[method] = vi.fn(() => q);
        q.limit = vi.fn(() => {
          orderFetches.push(organizationId);
          const data =
            organizationId === 'org-a'
              ? [currentOrder]
              : [
                  {
                    ...makeDeliveryOrder('B-200', 'Cliente B'),
                    status: 'out_for_delivery',
                    entregador_id: 'driver-2',
                  },
                ];
          return Promise.resolve({ data, error: null });
        });
        return q;
      }

      if (table === 'settings') {
        return resolvedQuery({
          data: {
            store_name: 'Loja',
            scheduling_preparation_lead_min: 30,
            delivery_assignment_mode: assignmentMode,
          },
          error: null,
        });
      }

      if (table === 'entregadores') {
        return resolvedQuery({
          data: [
            { id: 'driver-1', name: 'Entregador 1', active: true },
            { id: 'driver-2', name: 'Entregador 2', active: true },
          ],
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
    promptMock?.mockRestore();
    confirmMock?.mockRestore();
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  const renderPanel = async (organizationId = 'org-a') => {
    await act(async () => {
      root.render(<OrdersPanel organizationId={organizationId} />);
      await flushAsync();
    });
  };

  const findReturnButton = () =>
    Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Pedido voltou à loja'),
    ) as HTMLButtonElement | undefined;

  const findTrackButton = () =>
    Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Ver Moto em Tempo Real'),
    ) as HTMLButtonElement | undefined;

  const clickReturn = async (times = 1) => {
    const button = findReturnButton();
    expect(button).toBeTruthy();
    await act(async () => {
      for (let i = 0; i < times; i += 1) {
        button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      await flushAsync();
    });
  };

  it('cancels immediately when the reason prompt is dismissed', async () => {
    promptMock.mockReturnValue(null);
    await renderPanel();

    await clickReturn();

    expect(confirmMock).not.toHaveBeenCalled();
    expect(returnCalls).toHaveLength(0);
    expect(orderFetches).toEqual(['org-a']);
    expect(findReturnButton()?.disabled).toBe(false);
  });

  it('trims the reason, sends the canonical payload, closes tracking, refetches and reports manual success', async () => {
    await renderPanel();

    const trackButton = findTrackButton();
    expect(trackButton).toBeTruthy();
    await act(async () => {
      trackButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });
    expect(container.textContent).toContain('Rastreio em tempo real');

    await clickReturn();

    expect(rpcMock).toHaveBeenCalledWith('visionfood_return_delivery_to_queue', {
      _order_id: 'order-A-100',
      _reason: 'retorno confirmado',
    });
    expect(returnCalls).toEqual([
      { orderId: 'order-A-100', reason: 'retorno confirmado' },
    ]);
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Entrega voltou para “Pronto” e aguarda outro entregador.',
    );
    expect(container.textContent).not.toContain('Rastreio em tempo real');
    expect(orderFetches).toEqual(['org-a', 'org-a']);
  });

  it('rejects a trimmed reason shorter than 3 characters before confirmation or RPC', async () => {
    promptMock.mockReturnValue(' a ');
    await renderPanel();

    await clickReturn();

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Informe um motivo com pelo menos 3 caracteres.',
    );
    expect(confirmMock).not.toHaveBeenCalled();
    expect(returnCalls).toHaveLength(0);
    expect(orderFetches).toEqual(['org-a']);
  });

  it('does not call the RPC when physical-return confirmation is cancelled', async () => {
    confirmMock.mockReturnValue(false);
    await renderPanel();

    await clickReturn();

    expect(confirmMock).toHaveBeenCalledWith(
      'Confirme somente se o pedido físico já retornou à loja e está disponível para outro entregador. Continuar?',
    );
    expect(returnCalls).toHaveLength(0);
    expect(orderFetches).toEqual(['org-a']);
  });

  it('reports free-mode success without changing the canonical RPC payload', async () => {
    assignmentMode = 'free';
    await renderPanel();

    await clickReturn();

    expect(returnCalls).toEqual([
      { orderId: 'order-A-100', reason: 'retorno confirmado' },
    ]);
    expect(toastSuccessMock).toHaveBeenCalledWith('Entrega devolvida à disputa livre.');
    expect(orderFetches).toEqual(['org-a', 'org-a']);
  });

  it.each([
    ['not_out_for_delivery', 'Esta entrega não está mais em rota.'],
    ['driver_missing', 'O pedido não possui entregador atribuído.'],
    ['reason_required', 'Informe o motivo.'],
    ['forbidden', 'Sem permissão para devolver esta entrega à fila.'],
    ['unauthenticated', 'Não foi possível devolver a entrega à fila.'],
    ['not_found', 'Não foi possível devolver a entrega à fila.'],
    ['not_delivery', 'Não foi possível devolver a entrega à fila.'],
  ])('maps return-to-queue reason %s and refetches the order', async (reason, message) => {
    returnResponder = async () => ({
      data: { ok: false, reason },
      error: null,
    });

    await renderPanel();
    await clickReturn();

    expect(toastErrorMock).toHaveBeenCalledWith(message);
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a', 'org-a']);
    expect(findReturnButton()?.disabled).toBe(false);
  });

  it('handles a Supabase error, refetches and releases busy state', async () => {
    returnResponder = async () => ({
      data: null,
      error: { message: 'database unavailable' },
    });

    await renderPanel();
    await clickReturn();

    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível devolver a entrega à fila.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a', 'org-a']);
    expect(findReturnButton()?.disabled).toBe(false);
  });

  it('fails closed on a malformed error payload and refetches', async () => {
    returnResponder = async () => ({
      data: { ok: false },
      error: null,
    });

    await renderPanel();
    await clickReturn();

    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível devolver a entrega à fila.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a', 'org-a']);
    expect(findReturnButton()?.disabled).toBe(false);
  });

  it('does not accept a malformed success payload', async () => {
    returnResponder = async () => ({
      data: { ok: true },
      error: null,
    });

    await renderPanel();
    await clickReturn();

    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível devolver a entrega à fila.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a', 'org-a']);
    expect(findReturnButton()?.disabled).toBe(false);
  });

  it('contains a transport rejection, refetches and releases busy state', async () => {
    returnResponder = async () => {
      throw new Error('return delivery network unavailable');
    };

    await renderPanel();
    await clickReturn();
    await act(async () => {
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível devolver a entrega à fila.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a', 'org-a']);
    expect(findReturnButton()?.disabled).toBe(false);
  });

  it('blocks two return requests dispatched in the same turn while the first RPC is pending', async () => {
    const request = deferred<any>();
    returnResponder = () => request.promise;

    await renderPanel();
    await clickReturn(2);

    expect(returnCalls).toEqual([
      { orderId: 'order-A-100', reason: 'retorno confirmado' },
    ]);
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(findReturnButton()?.disabled).toBe(true);

    currentOrder = {
      ...currentOrder,
      status: 'ready',
      entregador_id: null,
      delivery_issue_reason: null,
      delivery_issue_at: null,
    };
    await act(async () => {
      request.resolve({
        data: { ok: true, status: 'ready', returned_to_queue: true },
        error: null,
      });
      await flushAsync();
    });

    expect(orderFetches).toEqual(['org-a', 'org-a']);
  });

  it('ignores a pending return result after the organization changes', async () => {
    const request = deferred<any>();
    returnResponder = () => request.promise;

    await renderPanel('org-a');
    await clickReturn();
    expect(returnCalls).toHaveLength(1);
    expect(orderFetches).toEqual(['org-a']);

    await renderPanel('org-b');
    expect(orderFetches).toEqual(['org-a', 'org-b']);

    await act(async () => {
      request.resolve({
        data: { ok: true, status: 'ready', returned_to_queue: true },
        error: null,
      });
      await flushAsync();
    });

    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a', 'org-b']);
  });

  it('handles a server status change while the return RPC is pending', async () => {
    const request = deferred<any>();
    returnResponder = () => request.promise;

    await renderPanel();
    expect(realtimeCallbacks).toHaveLength(1);
    await clickReturn();

    currentOrder = { ...currentOrder, status: 'delivered' };
    await act(async () => {
      realtimeCallbacks[0]();
      await flushAsync();
    });

    expect(findReturnButton()).toBeUndefined();
    expect(orderFetches).toEqual(['org-a', 'org-a']);

    await act(async () => {
      request.resolve({
        data: { ok: false, reason: 'not_out_for_delivery', current_status: 'delivered' },
        error: null,
      });
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith('Esta entrega não está mais em rota.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(orderFetches).toEqual(['org-a', 'org-a', 'org-a']);
  });

  it('reconciles a driver change while the return RPC is pending', async () => {
    const request = deferred<any>();
    returnResponder = () => request.promise;

    await renderPanel();
    expect(realtimeCallbacks).toHaveLength(1);
    await clickReturn();

    currentOrder = { ...currentOrder, entregador_id: 'driver-2' };
    await act(async () => {
      realtimeCallbacks[0]();
      await flushAsync();
    });

    expect(findReturnButton()).toBeTruthy();
    expect(orderFetches).toEqual(['org-a', 'org-a']);

    currentOrder = {
      ...currentOrder,
      status: 'ready',
      entregador_id: null,
      delivery_issue_reason: null,
      delivery_issue_at: null,
    };
    await act(async () => {
      request.resolve({
        data: { ok: true, status: 'ready', returned_to_queue: true },
        error: null,
      });
      await flushAsync();
    });

    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Entrega voltou para “Pronto” e aguarda outro entregador.',
    );
    expect(orderFetches).toEqual(['org-a', 'org-a', 'org-a']);
  });
});


describe('OrdersPanel confirmPayment contract and lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let currentOrder: ReturnType<typeof makeOrder>;
  let orderFetches: string[];
  let paymentCalls: Array<{ _order_id: string }>;
  let paymentResponder: (args: { _order_id: string }) => Promise<any>;
  let realtimeCallbacks: Array<() => void>;
  let confirmMock: any;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();

    currentOrder = { ...makeOrder('A-100', 'Cliente A'), payment_status: 'pending' };
    orderFetches = [];
    paymentCalls = [];
    realtimeCallbacks = [];
    confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);

    paymentResponder = async args => {
      currentOrder = { ...currentOrder, payment_status: 'paid' };
      return {
        data: { ok: true, order_id: args._order_id, payment_status: 'paid' },
        error: null,
      };
    };

    channelMock.mockImplementation((channel: string) => {
      const ch: any = {};
      ch.on = vi.fn((_event: string, _config: unknown, callback: () => void) => {
        if (channel === 'admin-orders-org-a') realtimeCallbacks.push(callback);
        return ch;
      });
      ch.subscribe = vi.fn(() => ch);
      return ch;
    });

    rpcMock.mockImplementation((fn: string, args?: any) => {
      if (fn === 'visionfood_admin_tables') return Promise.resolve({ data: [], error: null });
      if (fn === 'confirm_order_payment') {
        const payload = { _order_id: args?._order_id || '' };
        paymentCalls.push(payload);
        return paymentResponder(payload);
      }
      return Promise.resolve({ data: [], error: null });
    });

    fromMock.mockImplementation((table: string) => {
      if (table === 'orders') {
        let organizationId = '';
        const q: any = {};
        q.select = vi.fn(() => q);
        q.eq = vi.fn((column: string, value: string) => {
          if (column === 'organization_id') organizationId = value;
          return q;
        });
        for (const method of ['order', 'in', 'not', 'gte', 'lte']) q[method] = vi.fn(() => q);
        q.limit = vi.fn(() => {
          orderFetches.push(organizationId);
          const data =
            organizationId === 'org-a'
              ? [currentOrder]
              : [{ ...makeOrder('B-200', 'Cliente B'), payment_status: 'pending' }];
          return Promise.resolve({ data, error: null });
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

      if (table === 'entregadores') {
        return resolvedQuery({ data: [], error: null });
      }

      return resolvedQuery({ data: [], error: null });
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    confirmMock?.mockRestore();
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  const renderPanel = async (organizationId = 'org-a') => {
    await act(async () => {
      root.render(<OrdersPanel organizationId={organizationId} />);
      await flushAsync();
    });
  };

  const findPaymentButton = () =>
    Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Confirmar pagamento'),
    ) as HTMLButtonElement | undefined;

  const clickPayment = async (times = 1) => {
    const button = findPaymentButton();
    expect(button).toBeTruthy();
    await act(async () => {
      for (let i = 0; i < times; i += 1) {
        button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      await flushAsync();
    });
  };

  it('shows the action only for pending payment on a non-cancelled order', async () => {
    await renderPanel();
    expect(findPaymentButton()).toBeTruthy();

    currentOrder = { ...currentOrder, payment_status: 'paid' };
    await act(async () => {
      realtimeCallbacks[0]();
      await flushAsync();
    });
    expect(findPaymentButton()).toBeUndefined();

    currentOrder = { ...currentOrder, payment_status: 'pending', status: 'cancelled' };
    await act(async () => {
      realtimeCallbacks[0]();
      await flushAsync();
    });
    expect(findPaymentButton()).toBeUndefined();
  });

  it('does not call confirm_order_payment when the confirmation dialog is cancelled', async () => {
    confirmMock.mockReturnValue(false);
    await renderPanel();

    await clickPayment();

    expect(confirmMock).toHaveBeenCalledWith('Confirmar que este pagamento foi recebido?');
    expect(paymentCalls).toHaveLength(0);
    expect(findPaymentButton()?.disabled).toBe(false);
  });

  it('sends the canonical _order_id payload and accepts the normal authoritative success shape', async () => {
    await renderPanel();

    await clickPayment();

    expect(paymentCalls).toEqual([{ _order_id: 'order-A-100' }]);
    expect(rpcMock).toHaveBeenCalledWith('confirm_order_payment', {
      _order_id: 'order-A-100',
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Pagamento confirmado.');
    expect(container.textContent).toContain('✅ Pago');
    expect(findPaymentButton()).toBeUndefined();
  });

  it('accepts the authoritative already_paid success shape', async () => {
    paymentResponder = async () => ({
      data: {
        ok: true,
        already_paid: true,
        payment_confirmed_at: '2026-09-24T20:00:00.000Z',
      },
      error: null,
    });

    await renderPanel();
    await clickPayment();

    expect(toastSuccessMock).toHaveBeenCalledWith('Pagamento já estava confirmado.');
    expect(container.textContent).toContain('✅ Pago');
    expect(findPaymentButton()).toBeUndefined();
  });

  it.each([
    'unauthenticated',
    'not_found',
    'forbidden',
    'order_cancelled',
    'payment_status_locked',
  ])('fails closed for confirm_order_payment reason %s and releases busy state', async reason => {
    paymentResponder = async () => ({
      data: { ok: false, reason },
      error: null,
    });

    await renderPanel();
    await clickPayment();

    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível confirmar o pagamento.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(findPaymentButton()?.disabled).toBe(false);
  });

  it('fails closed on a Supabase error response and releases busy state', async () => {
    paymentResponder = async () => ({
      data: null,
      error: { message: 'database unavailable' },
    });

    await renderPanel();
    await clickPayment();

    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível confirmar o pagamento.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(findPaymentButton()?.disabled).toBe(false);
  });

  it('fails closed on malformed error payload', async () => {
    paymentResponder = async () => ({
      data: { ok: false },
      error: null,
    });

    await renderPanel();
    await clickPayment();

    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível confirmar o pagamento.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(findPaymentButton()?.disabled).toBe(false);
  });

  it('does not accept malformed success payload', async () => {
    paymentResponder = async () => ({
      data: { ok: true },
      error: null,
    });

    await renderPanel();
    await clickPayment();

    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível confirmar o pagamento.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('💳 Pagamento pendente');
    expect(findPaymentButton()?.disabled).toBe(false);
  });

  it('contains a transport rejection and releases busy state', async () => {
    paymentResponder = async () => {
      throw new Error('confirm payment network unavailable');
    };

    await renderPanel();
    await clickPayment();
    await act(async () => {
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível confirmar o pagamento.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(findPaymentButton()?.disabled).toBe(false);
  });

  it('blocks two confirmation events dispatched in the same turn while the first RPC is pending', async () => {
    const request = deferred<any>();
    paymentResponder = () => request.promise;

    await renderPanel();
    await clickPayment(2);

    currentOrder = { ...currentOrder, payment_status: 'paid' };
    await act(async () => {
      request.resolve({
        data: { ok: true, order_id: 'order-A-100', payment_status: 'paid' },
        error: null,
      });
      await flushAsync();
    });

    expect(paymentCalls).toEqual([{ _order_id: 'order-A-100' }]);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a pending payment result after the organization changes', async () => {
    const request = deferred<any>();
    paymentResponder = () => request.promise;

    await renderPanel('org-a');
    await clickPayment();
    expect(paymentCalls).toEqual([{ _order_id: 'order-A-100' }]);

    await renderPanel('org-b');
    expect(container.textContent).toContain('#B-200');

    await act(async () => {
      request.resolve({
        data: { ok: true, order_id: 'order-A-100', payment_status: 'paid' },
        error: null,
      });
      await flushAsync();
    });

    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('#B-200');
    expect(container.textContent).not.toContain('#A-100');
  });

  it('does not let an older successful RPC overwrite a newer payment status from realtime', async () => {
    const request = deferred<any>();
    paymentResponder = () => request.promise;

    await renderPanel();
    await clickPayment();

    currentOrder = { ...currentOrder, payment_status: 'refunded' };
    await act(async () => {
      realtimeCallbacks[0]();
      await flushAsync();
    });
    expect(container.textContent).toContain('↩️ Reembolsado');

    await act(async () => {
      request.resolve({
        data: { ok: true, order_id: 'order-A-100', payment_status: 'paid' },
        error: null,
      });
      await flushAsync();
    });

    expect(container.textContent).toContain('↩️ Reembolsado');
    expect(container.textContent).not.toContain('✅ Pago');
  });

  it('preserves a cancellation received while the RPC is pending', async () => {
    const request = deferred<any>();
    paymentResponder = () => request.promise;

    await renderPanel();
    await clickPayment();

    currentOrder = { ...currentOrder, status: 'cancelled' };
    await act(async () => {
      realtimeCallbacks[0]();
      await flushAsync();
    });
    expect(findPaymentButton()).toBeUndefined();

    await act(async () => {
      request.resolve({
        data: { ok: false, reason: 'order_cancelled' },
        error: null,
      });
      await flushAsync();
    });

    expect(findPaymentButton()).toBeUndefined();
    expect(container.textContent).toContain('❌ Cancelado');
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('handles payment becoming paid while the RPC is pending and server returns already_paid', async () => {
    const request = deferred<any>();
    paymentResponder = () => request.promise;

    await renderPanel();
    await clickPayment();

    currentOrder = { ...currentOrder, payment_status: 'paid' };
    await act(async () => {
      realtimeCallbacks[0]();
      await flushAsync();
    });
    expect(findPaymentButton()).toBeUndefined();

    await act(async () => {
      request.resolve({
        data: {
          ok: true,
          already_paid: true,
          payment_confirmed_at: '2026-09-24T20:00:00.000Z',
        },
        error: null,
      });
      await flushAsync();
    });

    expect(container.textContent).toContain('✅ Pago');
    expect(toastSuccessMock).toHaveBeenCalledWith('Pagamento já estava confirmado.');
  });

  it('reconciles order_cancelled from the authoritative RPC instead of leaving stale pending UI', async () => {
    paymentResponder = async () => {
      currentOrder = { ...currentOrder, status: 'cancelled' };
      return {
        data: { ok: false, reason: 'order_cancelled' },
        error: null,
      };
    };

    await renderPanel();
    await clickPayment();

    expect(orderFetches).toEqual(['org-a', 'org-a']);
    expect(container.textContent).toContain('❌ Cancelado');
    expect(findPaymentButton()).toBeUndefined();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('reconciles payment_status_locked from the authoritative RPC instead of leaving stale pending UI', async () => {
    paymentResponder = async () => {
      currentOrder = { ...currentOrder, payment_status: 'refunded' };
      return {
        data: { ok: false, reason: 'payment_status_locked' },
        error: null,
      };
    };

    await renderPanel();
    await clickPayment();

    expect(orderFetches).toEqual(['org-a', 'org-a']);
    expect(container.textContent).toContain('↩️ Reembolsado');
    expect(findPaymentButton()).toBeUndefined();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

});
