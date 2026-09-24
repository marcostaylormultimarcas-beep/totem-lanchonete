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
