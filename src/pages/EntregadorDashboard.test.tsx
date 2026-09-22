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
  toastInfoMock,
  removeChannelMock,
  geocodeAddressMock,
  watchPositionMock,
  clearWatchMock,
  getCurrentPositionMock,
} = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastInfoMock: vi.fn(),
  removeChannelMock: vi.fn(),
  geocodeAddressMock: vi.fn(),
  watchPositionMock: vi.fn(),
  clearWatchMock: vi.fn(),
  getCurrentPositionMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: rpcMock,
    removeChannel: removeChannelMock,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    info: toastInfoMock,
  },
}));

vi.mock('@/data/store', () => ({
  formatCurrency: (value: number) => `R$ ${Number(value).toFixed(2)}`,
}));

vi.mock('@/components/LiveDeliveryMap', () => ({
  default: () => null,
}));

vi.mock('@/lib/cep', () => ({
  geocodeAddress: geocodeAddressMock,
}));

vi.mock('@/lib/deliveryRouting', () => ({
  googleMapsDirectionsUrl: () => 'https://maps.example/directions',
  MAX_DRIVER_CONFIRM_ACCURACY_M: 100,
  MAX_EXACT_DESTINATION_ACCURACY_M: 100,
}));

import EntregadorDashboard from '@/pages/EntregadorDashboard';

const session = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Motorista',
  username: 'motorista',
  organization_id: '22222222-2222-2222-2222-222222222222',
  org_slug: 'loja-a',
  org_name: 'Loja A',
  session_token: 'a'.repeat(64),
  expires_at: '2099-01-01T00:00:00.000Z',
};

const makeOrder = (status: string) => ({
  id: '33333333-3333-3333-3333-333333333333',
  order_number: '42',
  customer_name: 'Cliente',
  customer_phone: '62999999999',
  delivery_address: 'Rua Teste, 123',
  delivery_reference: null,
  delivery_recipient: null,
  items: [{ name: 'Produto', quantity: 1 }],
  total: 25,
  status,
  created_at: '2026-09-22T12:00:00.000Z',
  scheduled_for: null,
  bairro_nome: 'Centro',
  delivery_lat: null,
  delivery_lng: null,
  delivery_accuracy_m: null,
});

const makePosition = (lat: number, lng: number, accuracy: number) => ({
  coords: {
    latitude: lat,
    longitude: lng,
    accuracy,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    toJSON: () => ({}),
  },
  timestamp: Date.now(),
  toJSON: () => ({}),
} as GeolocationPosition);

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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function renderDashboard(root: Root) {
  root.render(
    <MemoryRouter initialEntries={['/entregador']}>
      <Routes>
        <Route path="/entregador" element={<EntregadorDashboard />} />
        <Route path="/entregador/login" element={<div>LOGIN ENTREGADOR</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EntregadorDashboard assigned orders polling', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.useRealTimers();
    geocodeAddressMock.mockResolvedValue(null);
    watchPositionMock.mockImplementation((success: PositionCallback) => {
      success({
        coords: {
          latitude: -16.328,
          longitude: -48.953,
          accuracy: 12,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        },
        timestamp: Date.now(),
        toJSON: () => ({}),
      } as GeolocationPosition);
      return 7;
    });
    clearWatchMock.mockImplementation(() => {});
    getCurrentPositionMock.mockImplementation((success: PositionCallback) => {
      success({
        coords: {
          latitude: -16.328,
          longitude: -48.953,
          accuracy: 12,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        },
        timestamp: Date.now(),
        toJSON: () => ({}),
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: watchPositionMock,
        clearWatch: clearWatchMock,
        getCurrentPosition: getCurrentPositionMock,
      },
    });
    localStorage.clear();
    localStorage.setItem('entregador_session', JSON.stringify(session));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('shows a recoverable load error instead of a false empty-order state when the initial request fails', async () => {
    let ordersCalls = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        if (ordersCalls === 1) return Promise.reject(new Error('network unavailable'));
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('preparing')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    expect(container.textContent).toContain('Não foi possível carregar seus pedidos');
    expect(container.textContent).toContain('Tentar novamente');
    expect(container.textContent).not.toContain('Nenhum pedido atribuído no momento.');

    const retry = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Tentar novamente'));

    await act(async () => {
      retry?.click();
      await flushAsync();
    });

    expect(container.textContent).toContain('#42');
    expect(container.textContent).toContain('Preparando');
    expect(container.textContent).not.toContain('Não foi possível carregar seus pedidos');

    await act(async () => root.unmount());
    container.remove();
  });

  it('ignores an older refresh response that arrives after a newer assigned-order snapshot', async () => {
    const older = deferred<any>();
    const newer = deferred<any>();
    let ordersCalls = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        if (ordersCalls === 1) {
          return Promise.resolve({ data: { ok: true, orders: [makeOrder('preparing')] }, error: null });
        }
        if (ordersCalls === 2) return older.promise;
        if (ordersCalls === 3) return newer.promise;
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('ready')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    expect(container.textContent).toContain('Preparando');

    const refresh = container.querySelector<HTMLButtonElement>('button[title="Atualizar"]');
    expect(refresh).toBeTruthy();

    await act(async () => {
      refresh?.click();
      refresh?.click();
      await Promise.resolve();
    });

    await act(async () => {
      newer.resolve({ data: { ok: true, orders: [makeOrder('ready')] }, error: null });
      await flushAsync();
    });

    expect(container.textContent).toContain('Pronto p/ retirar');

    await act(async () => {
      older.resolve({ data: { ok: true, orders: [makeOrder('preparing')] }, error: null });
      await flushAsync();
    });

    expect(container.textContent).toContain('Pronto p/ retirar');
    expect(container.textContent).not.toContain('Pedido ainda em preparo');

    await act(async () => root.unmount());
    container.remove();
  });

  it('surfaces an available-orders refresh failure and recovers without hiding it as manual mode', async () => {
    let availableCalls = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        availableCalls += 1;
        if (availableCalls === 1) return Promise.reject(new Error('network unavailable'));
        return Promise.resolve({ data: { ok: true, mode: 'free', orders: [makeOrder('ready')] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    expect(container.textContent).toContain('Não foi possível atualizar os pedidos disponíveis');
    expect(container.textContent).toContain('Tentar agora');

    const retry = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Tentar agora'));

    await act(async () => {
      retry?.click();
      await flushAsync();
    });

    expect(container.textContent).toContain('Disponíveis');
    expect(container.textContent).not.toContain('Não foi possível atualizar os pedidos disponíveis');

    await act(async () => root.unmount());
    container.remove();
  });

  it('does not start another automatic polling round while the previous one is still pending', async () => {
    vi.useFakeTimers();
    const slowOrders = deferred<any>();
    let ordersCalls = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        if (ordersCalls === 1) {
          return Promise.resolve({ data: { ok: true, orders: [makeOrder('preparing')] }, error: null });
        }
        if (ordersCalls === 2) return slowOrders.promise;
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('ready')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    expect(container.textContent).toContain('Preparando');

    await act(async () => {
      vi.advanceTimersByTime(15000);
      await flushAsync();
    });
    expect(ordersCalls).toBe(2);

    await act(async () => {
      vi.advanceTimersByTime(15000);
      await flushAsync();
    });
    expect(ordersCalls).toBe(2);

    await act(async () => {
      slowOrders.resolve({ data: { ok: true, orders: [makeOrder('ready')] }, error: null });
      await flushAsync();
    });

    expect(container.textContent).toContain('Pronto p/ retirar');

    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('keeps the newest available-orders mode when polling responses arrive out of order', async () => {
    vi.useFakeTimers();
    const older = deferred<any>();
    const newer = deferred<any>();
    let availableCalls = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        availableCalls += 1;
        if (availableCalls === 1) {
          return Promise.resolve({ data: { ok: true, mode: 'free', orders: [makeOrder('ready')] }, error: null });
        }
        if (availableCalls === 2) return older.promise;
        if (availableCalls === 3) return newer.promise;
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const availableTab = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Disponíveis'));
    expect(availableTab).toBeTruthy();

    await act(async () => {
      availableTab?.click();
      vi.advanceTimersByTime(15000);
      await flushAsync();
      vi.advanceTimersByTime(15000);
      await flushAsync();
    });

    await act(async () => {
      newer.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      await flushAsync();
    });

    expect(container.textContent).not.toContain('Modo Disputa Livre');
    expect(container.textContent).toContain('Nenhum pedido atribuído no momento.');

    await act(async () => {
      older.resolve({ data: { ok: true, mode: 'free', orders: [makeOrder('ready')] }, error: null });
      await flushAsync();
    });

    expect(container.textContent).not.toContain('Modo Disputa Livre');
    expect(container.textContent).toContain('Nenhum pedido atribuído no momento.');

    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  it('releases the claim action after a network failure and keeps the available order retryable', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'free', orders: [makeOrder('ready')] }, error: null });
      }
      if (name === 'entregador_claim_order_session') {
        return Promise.reject(new Error('network unavailable'));
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const availableTab = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Disponíveis'));
    await act(async () => {
      availableTab?.click();
      await flushAsync();
    });

    const claim = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('ACEITAR PEDIDO'));
    expect(claim).toBeTruthy();

    await act(async () => {
      claim?.click();
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Não foi possível aceitar o pedido agora. Verifique a conexão e tente novamente.',
    );
    const retryableClaim = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('ACEITAR PEDIDO'));
    expect(retryableClaim?.disabled).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });

  it('prevents duplicate claim RPCs while one free-order claim is still in flight', async () => {
    const claimDeferred = deferred<any>();
    let claimCalls = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'free', orders: [makeOrder('ready')] }, error: null });
      }
      if (name === 'entregador_claim_order_session') {
        claimCalls += 1;
        return claimDeferred.promise;
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const availableTab = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Disponíveis'));
    await act(async () => {
      availableTab?.click();
      await flushAsync();
    });

    const claim = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('ACEITAR PEDIDO'));
    expect(claim).toBeTruthy();

    await act(async () => {
      claim?.click();
      claim?.click();
      await Promise.resolve();
    });

    expect(claimCalls).toBe(1);
    expect(container.textContent).toContain('Aceitando...');

    await act(async () => {
      claimDeferred.resolve({
        data: {
          ok: true,
          status: 'ready',
          reserved: true,
          entregador_id: session.id,
        },
        error: null,
      });
      await flushAsync();
    });

    expect(toastSuccessMock).toHaveBeenCalledWith(
      '🛵 Pedido reservado para você. Retire na loja e confirme quando estiver com o pedido.',
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it('releases the start-delivery action after a network failure and keeps the order retryable', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('ready')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'entregador_start_delivery_session') {
        return Promise.reject(new Error('network unavailable'));
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const start = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Retirei · Iniciar entrega'));
    expect(start).toBeTruthy();

    await act(async () => {
      start?.click();
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Não foi possível iniciar a entrega agora. Verifique a conexão e tente novamente.',
    );
    const retryableStart = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Retirei · Iniciar entrega'));
    expect(retryableStart?.disabled).toBe(false);
    expect(container.textContent).toContain('Pronto p/ retirar');

    await act(async () => root.unmount());
    container.remove();
  });

  it('prevents duplicate start-delivery RPCs while the first request is still in flight', async () => {
    const startDeferred = deferred<any>();
    let startCalls = 0;
    let ordersCalls = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        return Promise.resolve({
          data: { ok: true, orders: [makeOrder(ordersCalls === 1 ? 'ready' : 'out_for_delivery')] },
          error: null,
        });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'entregador_start_delivery_session') {
        startCalls += 1;
        return startDeferred.promise;
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const start = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Retirei · Iniciar entrega'));
    expect(start).toBeTruthy();

    await act(async () => {
      start?.click();
      start?.click();
      await Promise.resolve();
    });

    expect(startCalls).toBe(1);
    expect(container.textContent).toContain('Iniciando...');

    await act(async () => {
      startDeferred.resolve({
        data: { ok: true, status: 'out_for_delivery', idempotent: false },
        error: null,
      });
      await flushAsync();
    });

    expect(toastSuccessMock).toHaveBeenCalledWith(
      '🛵 Entrega iniciada. Agora o pedido está oficialmente a caminho.',
    );
    expect(container.textContent).toContain('A caminho');

    await act(async () => root.unmount());
    container.remove();
  });

  it('releases the decline action after a network failure and keeps the assigned order visible', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Problema com o veículo');

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('ready')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'entregador_decline_order_session') {
        return Promise.reject(new Error('network unavailable'));
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const decline = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Não posso realizar'));
    expect(decline).toBeTruthy();

    await act(async () => {
      decline?.click();
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Não foi possível devolver a entrega agora. Verifique a conexão e tente novamente.',
    );
    const retryableDecline = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Não posso realizar'));
    expect(retryableDecline?.disabled).toBe(false);
    expect(container.textContent).toContain('#42');

    promptSpy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  });

  it('uses the backend returned_to_queue flag instead of stale local free-mode state after decline', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Não consigo realizar agora');
    let availableCalls = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('ready')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        availableCalls += 1;
        if (availableCalls === 1) {
          return Promise.resolve({ data: { ok: true, mode: 'free', orders: [] }, error: null });
        }
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'entregador_decline_order_session') {
        return Promise.resolve({
          data: {
            ok: true,
            status: 'ready',
            assignment_mode: 'manual',
            returned_to_queue: false,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    expect(container.textContent).toContain('Modo Disputa Livre');

    const decline = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Não posso realizar'));

    await act(async () => {
      decline?.click();
      await flushAsync();
    });

    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Entrega devolvida para a loja escolher outro entregador.',
    );
    expect(container.textContent).toContain('Nenhum pedido atribuído no momento.');
    expect(container.textContent).not.toContain('Nenhum pedido disponível para disputa.');

    promptSpy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  });

  it('prevents duplicate decline RPCs while the first request is still in flight', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Problema com o veículo');
    const declineDeferred = deferred<any>();
    let declineCalls = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('ready')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'entregador_decline_order_session') {
        declineCalls += 1;
        return declineDeferred.promise;
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const decline = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Não posso realizar'));
    expect(decline).toBeTruthy();

    await act(async () => {
      decline?.click();
      decline?.click();
      await Promise.resolve();
    });

    expect(declineCalls).toBe(1);
    expect(container.textContent).toContain('Devolvendo...');

    await act(async () => {
      declineDeferred.resolve({
        data: {
          ok: true,
          status: 'ready',
          assignment_mode: 'manual',
          returned_to_queue: false,
        },
        error: null,
      });
      await flushAsync();
    });

    promptSpy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  });

  it('releases issue reporting after a network failure and keeps the delivery actionable', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Cliente não atende');

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('out_for_delivery')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'entregador_report_delivery_issue_session') {
        return Promise.reject(new Error('network unavailable'));
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const issue = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Problema na entrega'));
    expect(issue).toBeTruthy();

    await act(async () => {
      issue?.click();
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Não foi possível registrar o problema agora. Verifique a conexão e tente novamente.',
    );
    const retryableIssue = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Problema na entrega'));
    expect(retryableIssue?.disabled).toBe(false);
    expect(container.textContent).toContain('A caminho');

    promptSpy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  });

  it('prevents duplicate issue-report RPCs while the first report is still in flight', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Cliente não atende');
    const reportDeferred = deferred<any>();
    let reportCalls = 0;
    let ordersCalls = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        const order = makeOrder('out_for_delivery');
        if (ordersCalls > 1) {
          order.delivery_issue_reason = 'Cliente não atende';
          order.delivery_issue_at = '2026-09-22T16:30:00.000Z';
        }
        return Promise.resolve({ data: { ok: true, orders: [order] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'entregador_report_delivery_issue_session') {
        reportCalls += 1;
        return reportDeferred.promise;
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const issue = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Problema na entrega'));
    expect(issue).toBeTruthy();

    await act(async () => {
      issue?.click();
      issue?.click();
      await Promise.resolve();
    });

    expect(reportCalls).toBe(1);
    expect(container.textContent).toContain('Comunicando...');

    await act(async () => {
      reportDeferred.resolve({
        data: { ok: true, status: 'out_for_delivery', issue_reported: true },
        error: null,
      });
      await flushAsync();
    });

    expect(toastSuccessMock).toHaveBeenCalledWith(
      '⚠️ Problema comunicado à loja. Aguarde orientação antes de abandonar a entrega.',
    );
    expect(container.textContent).toContain('Cliente não atende');

    promptSpy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  });

  it('does not make approximate address geocoding a hard gate and releases confirmation after a network failure', async () => {
    let ordersCalls = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('out_for_delivery')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'confirm_delivery_with_code_session') {
        return Promise.reject(new Error('network unavailable'));
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const codeInput = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
    expect(codeInput).toBeTruthy();

    await act(async () => {
      if (codeInput) setInputValue(codeInput, '1234');
      await flushAsync();
    });

    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim().endsWith('OK'));
    expect(confirm).toBeTruthy();

    await act(async () => {
      confirm?.click();
      await flushAsync();
    });

    expect(geocodeAddressMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Não foi possível confirmar a entrega agora. Verifique a conexão e tente novamente.',
    );
    const retryableConfirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim().endsWith('OK'));
    expect(retryableConfirm?.disabled).toBe(false);
    expect(container.textContent).toContain('A caminho');

    await act(async () => root.unmount());
    container.remove();
  });

  it('prevents duplicate delivery-confirmation RPCs while the first confirmation is still in flight', async () => {
    const confirmDeferred = deferred<any>();
    let confirmCalls = 0;
    let ordersCalls = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        return Promise.resolve({
          data: { ok: true, orders: [makeOrder(ordersCalls === 1 ? 'out_for_delivery' : 'delivered')] },
          error: null,
        });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'confirm_delivery_with_code_session') {
        confirmCalls += 1;
        return confirmDeferred.promise;
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const codeInput = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
    await act(async () => {
      if (codeInput) setInputValue(codeInput, '1234');
      await flushAsync();
    });

    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim().endsWith('OK'));
    expect(confirm).toBeTruthy();

    await act(async () => {
      confirm?.click();
      confirm?.click();
      await Promise.resolve();
    });

    expect(confirmCalls).toBe(1);

    await act(async () => {
      confirmDeferred.resolve({ data: { ok: true, status: 'delivered' }, error: null });
      await flushAsync();
    });

    expect(toastSuccessMock).toHaveBeenCalledWith('✅ Entrega confirmada!');
    expect(container.textContent).toContain('Nenhum pedido atribuído no momento.');

    await act(async () => root.unmount());
    container.remove();
  });

  it('treats already_delivered as authoritative recovery after a lost success response', async () => {
    let ordersCalls = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        return Promise.resolve({
          data: { ok: true, orders: [makeOrder(ordersCalls === 1 ? 'out_for_delivery' : 'delivered')] },
          error: null,
        });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'confirm_delivery_with_code_session') {
        return Promise.resolve({ data: { ok: false, reason: 'already_delivered' }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const codeInput = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
    await act(async () => {
      if (codeInput) setInputValue(codeInput, '1234');
      await flushAsync();
    });

    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim().endsWith('OK'));

    await act(async () => {
      confirm?.click();
      await flushAsync();
    });

    expect(toastInfoMock).toHaveBeenCalledWith('✅ Esta entrega já estava confirmada. Status sincronizado.');
    expect(container.textContent).toContain('Nenhum pedido atribuído no momento.');

    const historyTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Histórico'));
    await act(async () => {
      historyTab?.click();
      await flushAsync();
    });
    expect(container.textContent).toContain('✓ Entregue');

    await act(async () => root.unmount());
    container.remove();
  });

  it('always clears the local driver session and navigates to login when server logout fails', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'entregador_logout_session') {
        return Promise.reject(new Error('network unavailable'));
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const logout = container.querySelector<HTMLButtonElement>('button[title="Sair"]');
    expect(logout).toBeTruthy();

    await act(async () => {
      logout?.click();
      await flushAsync();
    });

    expect(localStorage.getItem('entregador_session')).toBeNull();
    expect(container.textContent).toContain('LOGIN ENTREGADOR');
    expect(toastInfoMock).toHaveBeenCalledWith(
      'Você saiu deste dispositivo, mas não foi possível confirmar a revogação da sessão no servidor.',
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it('prevents duplicate logout RPCs while revocation is still in flight', async () => {
    const logoutDeferred = deferred<any>();
    let logoutCalls = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'entregador_logout_session') {
        logoutCalls += 1;
        return logoutDeferred.promise;
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const logout = container.querySelector<HTMLButtonElement>('button[title="Sair"]');
    expect(logout).toBeTruthy();

    await act(async () => {
      logout?.click();
      logout?.click();
      await Promise.resolve();
    });

    expect(logoutCalls).toBe(1);

    await act(async () => {
      logoutDeferred.resolve({ data: { ok: true }, error: null });
      await flushAsync();
    });

    expect(localStorage.getItem('entregador_session')).toBeNull();
    expect(container.textContent).toContain('LOGIN ENTREGADOR');
    expect(toastInfoMock).not.toHaveBeenCalledWith(
      'Você saiu deste dispositivo, mas não foi possível confirmar a revogação da sessão no servidor.',
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps local GPS tracking alive across a failed sync and reports recovery after the next successful send', async () => {
    vi.useFakeTimers();
    let locationSyncCalls = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('out_for_delivery')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'entregador_update_location_session') {
        locationSyncCalls += 1;
        if (locationSyncCalls === 1) return Promise.reject(new Error('network unavailable'));
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const mapButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Ver localização no mapa'));
    expect(mapButton).toBeTruthy();

    await act(async () => {
      mapButton?.click();
      await flushAsync();
    });

    expect(watchPositionMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('GPS ativo • aguardando primeiro envio');

    await act(async () => {
      vi.advanceTimersByTime(2500);
      await flushAsync();
    });

    expect(locationSyncCalls).toBe(1);
    expect(container.textContent).toContain('Sem conexão para sincronizar sua localização. Tentaremos novamente.');

    await act(async () => {
      vi.advanceTimersByTime(15000);
      await flushAsync();
    });

    expect(locationSyncCalls).toBe(2);
    expect(container.textContent).toContain('localização sincronizada com a loja');
    expect(container.textContent).not.toContain('Sem conexão para sincronizar sua localização');

    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('does not label GPS timeout as permission denied', async () => {
    watchPositionMock.mockImplementation((_success: PositionCallback, error: PositionErrorCallback) => {
      error({ code: 3, message: 'timeout', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      return 9;
    });

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('out_for_delivery')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const mapButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Ver localização no mapa'));

    await act(async () => {
      mapButton?.click();
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith('Tempo esgotado ao obter localização do GPS.');
    expect(toastErrorMock).not.toHaveBeenCalledWith('Permissão de localização negada.');
    expect(container.textContent).toContain('Tempo esgotado ao obter localização do GPS.');

    await act(async () => root.unmount());
    container.remove();
  });


  it('prevents duplicate distance refresh work while the first GPS read is still in flight', async () => {
    let positionSuccess: PositionCallback | null = null;
    getCurrentPositionMock.mockImplementation((success: PositionCallback) => {
      positionSuccess = success;
    });

    const order = {
      ...makeOrder('out_for_delivery'),
      delivery_lat: -16.328,
      delivery_lng: -48.953,
      delivery_accuracy_m: 12,
    };

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [order] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const refreshDistance = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Atualizar Localização'));
    expect(refreshDistance).toBeTruthy();

    await act(async () => {
      refreshDistance?.click();
      refreshDistance?.click();
      await Promise.resolve();
    });

    expect(getCurrentPositionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      positionSuccess?.(makePosition(-16.328, -48.953, 12));
      await flushAsync();
    });

    expect(container.textContent).toContain('0 m');

    await act(async () => root.unmount());
    container.remove();
  });

  it('clears a previous distance when a later GPS refresh is too imprecise', async () => {
    let gpsCalls = 0;
    getCurrentPositionMock.mockImplementation((success: PositionCallback) => {
      gpsCalls += 1;
      success(makePosition(-16.328, -48.953, gpsCalls === 1 ? 12 : 250));
    });

    const order = {
      ...makeOrder('out_for_delivery'),
      delivery_lat: -16.328,
      delivery_lng: -48.953,
      delivery_accuracy_m: 12,
    };

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [order] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const refreshDistance = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Atualizar Localização'));

    await act(async () => {
      refreshDistance?.click();
      await flushAsync();
    });
    expect(container.textContent).toContain('0 m');

    await act(async () => {
      refreshDistance?.click();
      await flushAsync();
    });

    expect(container.textContent).toContain('não verificada');
    expect(container.textContent).toContain('GPS impreciso (±250 m)');
    expect(container.textContent).not.toContain('Distância até o cliente: 0 m');

    await act(async () => root.unmount());
    container.remove();
  });

  it('rejects invalid geocoder coordinates instead of displaying a NaN distance as successful', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: Number.NaN, lng: -48.953 });

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('out_for_delivery')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const refreshDistance = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Atualizar Localização'));

    await act(async () => {
      refreshDistance?.click();
      await flushAsync();
    });

    expect(geocodeAddressMock).toHaveBeenCalledTimes(1);
    expect(getCurrentPositionMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Não foi possível localizar o endereço do cliente no mapa.');
    expect(container.textContent).not.toContain('NaN m');
    expect(toastSuccessMock).not.toHaveBeenCalledWith(expect.stringContaining('Localização OK'));

    await act(async () => root.unmount());
    container.remove();
  });

  it('shares one in-flight address geocode between map opening and distance refresh', async () => {
    const geocodeDeferred = deferred<{ lat: number; lng: number } | null>();
    geocodeAddressMock.mockReturnValue(geocodeDeferred.promise);

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('out_for_delivery')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      if (name === 'entregador_update_location_session') {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const mapButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Ver localização no mapa'));
    const refreshDistance = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Atualizar Localização'));

    await act(async () => {
      mapButton?.click();
      refreshDistance?.click();
      await Promise.resolve();
    });

    expect(geocodeAddressMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      geocodeDeferred.resolve({ lat: -16.328, lng: -48.953 });
      await flushAsync();
    });

    expect(getCurrentPositionMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('0 m');
    expect(container.textContent).toContain('destino aproximado pelo endereço');

    await act(async () => root.unmount());
    container.remove();
  });


  it('does not claim an approximate map destination when the order has no usable destination', async () => {
    const order = {
      ...makeOrder('out_for_delivery'),
      delivery_address: null,
    };

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [order] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const mapButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Ver localização no mapa'));

    await act(async () => {
      mapButton?.click();
      await flushAsync();
    });

    expect(geocodeAddressMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Destino do cliente indisponível neste pedido.');
    expect(container.textContent).not.toContain('destino aproximado pelo endereço');

    await act(async () => root.unmount());
    container.remove();
  });

  it('shows a destination lookup failure on the map instead of claiming an approximate destination', async () => {
    geocodeAddressMock.mockResolvedValue(null);

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [makeOrder('out_for_delivery')] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const mapButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Ver localização no mapa'));

    await act(async () => {
      mapButton?.click();
      await flushAsync();
    });

    expect(geocodeAddressMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Não foi possível localizar o destino do cliente no mapa.');
    expect(container.textContent).not.toContain('destino aproximado pelo endereço');

    await act(async () => root.unmount());
    container.remove();
  });


  it('resumes a suspended audio context before sounding a newly assigned order alert', async () => {
    let audioState = 'running';
    const startMock = vi.fn();
    const resumeMock = vi.fn(async () => {
      audioState = 'running';
    });
    const context = {
      get state() { return audioState; },
      currentTime: 0,
      destination: {},
      resume: resumeMock,
      createOscillator: vi.fn(() => ({
        connect: vi.fn(),
        frequency: { value: 0 },
        start: startMock,
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      })),
    };
    const AudioContextMock = vi.fn(function AudioContextMock() { return context; });
    vi.stubGlobal('AudioContext', AudioContextMock);

    let ordersCalls = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        return Promise.resolve({
          data: { ok: true, orders: ordersCalls === 1 ? [] : [makeOrder('ready')] },
          error: null,
        });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const unlock = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('ativar os alertas sonoros'));

    await act(async () => {
      unlock?.click();
      await flushAsync();
    });

    expect(resumeMock).not.toHaveBeenCalled();
    audioState = 'suspended';

    const refresh = container.querySelector<HTMLButtonElement>('button[title="Atualizar"]');
    await act(async () => {
      refresh?.click();
      await flushAsync();
    });

    expect(resumeMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(3);
    expect(toastSuccessMock).toHaveBeenCalledWith(
      '🛵 Novo pedido atribuído: #42',
      { duration: 6000 },
    );

    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('recreates a closed audio context before playing the next assigned-order alert', async () => {
    let firstState = 'running';
    const firstResumeMock = vi.fn(async () => {});
    const firstContext = {
      get state() { return firstState; },
      currentTime: 0,
      destination: {},
      resume: firstResumeMock,
      createOscillator: vi.fn(() => ({
        connect: vi.fn(),
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      })),
    };

    const replacementStartMock = vi.fn();
    const replacementContext = {
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {}),
      createOscillator: vi.fn(() => ({
        connect: vi.fn(),
        frequency: { value: 0 },
        start: replacementStartMock,
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      })),
    };

    const AudioContextMock = vi.fn(function AudioContextMock() { return replacementContext; })
      .mockImplementationOnce(function FirstAudioContextMock() { return firstContext; });
    vi.stubGlobal('AudioContext', AudioContextMock);

    let ordersCalls = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        return Promise.resolve({
          data: { ok: true, orders: ordersCalls === 1 ? [] : [makeOrder('ready')] },
          error: null,
        });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const unlock = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('ativar os alertas sonoros'));
    await act(async () => {
      unlock?.click();
      await flushAsync();
    });

    firstState = 'closed';

    const refresh = container.querySelector<HTMLButtonElement>('button[title="Atualizar"]');
    await act(async () => {
      refresh?.click();
      await flushAsync();
    });

    expect(AudioContextMock).toHaveBeenCalledTimes(2);
    expect(replacementStartMock).toHaveBeenCalledTimes(3);

    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('makes sound activation retryable when a suspended audio context cannot resume', async () => {
    let audioState = 'running';
    const resumeMock = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('audio unavailable'));
    const startMock = vi.fn();
    const context = {
      get state() { return audioState; },
      currentTime: 0,
      destination: {},
      resume: resumeMock,
      createOscillator: vi.fn(() => ({
        connect: vi.fn(),
        frequency: { value: 0 },
        start: startMock,
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      })),
    };
    vi.stubGlobal('AudioContext', vi.fn(function AudioContextMock() { return context; }));

    let ordersCalls = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        return Promise.resolve({
          data: { ok: true, orders: ordersCalls === 1 ? [] : [makeOrder('ready')] },
          error: null,
        });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const unlock = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('ativar os alertas sonoros'));
    await act(async () => {
      unlock?.click();
      await flushAsync();
    });

    audioState = 'suspended';

    const refresh = container.querySelector<HTMLButtonElement>('button[title="Atualizar"]');
    await act(async () => {
      refresh?.click();
      await flushAsync();
    });

    expect(startMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Os alertas sonoros foram pausados pelo navegador. Toque para ativá-los novamente.',
    );
    expect(container.textContent).toContain('ativar os alertas sonoros');

    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });


  it('does not mark sound alerts active when the audio context remains interrupted', async () => {
    const resumeMock = vi.fn(async () => {});
    const context = {
      state: 'interrupted',
      currentTime: 0,
      destination: {},
      resume: resumeMock,
      createOscillator: vi.fn(),
      createGain: vi.fn(),
    };
    vi.stubGlobal('AudioContext', vi.fn(function AudioContextMock() { return context; }));

    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        return Promise.resolve({ data: { ok: true, orders: [] }, error: null });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    const unlock = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('ativar os alertas sonoros'));
    expect(unlock).toBeTruthy();

    await act(async () => {
      unlock?.click();
      await flushAsync();
    });

    expect(resumeMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).not.toHaveBeenCalledWith('Alertas sonoros ativados.');
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível ativar o som.');
    expect(container.textContent).toContain('ativar os alertas sonoros');

    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('recreates a closed audio context when the driver retries sound activation', async () => {
    let firstState = 'running';
    const firstResumeMock = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('audio unavailable'));
    const firstContext = {
      get state() { return firstState; },
      currentTime: 0,
      destination: {},
      resume: firstResumeMock,
      createOscillator: vi.fn(() => ({
        connect: vi.fn(),
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      })),
    };

    const replacementContext = {
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {}),
      createOscillator: vi.fn(),
      createGain: vi.fn(),
    };

    const AudioContextMock = vi.fn(function AudioContextMock() { return replacementContext; })
      .mockImplementationOnce(function FirstAudioContextMock() { return firstContext; });
    vi.stubGlobal('AudioContext', AudioContextMock);

    let ordersCalls = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === 'entregador_orders_session') {
        ordersCalls += 1;
        return Promise.resolve({
          data: { ok: true, orders: ordersCalls === 1 ? [] : [makeOrder('ready')] },
          error: null,
        });
      }
      if (name === 'entregador_available_orders_session') {
        return Promise.resolve({ data: { ok: true, mode: 'manual', orders: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderDashboard(root);
      await flushAsync();
    });

    let unlock = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('ativar os alertas sonoros'));

    await act(async () => {
      unlock?.click();
      await flushAsync();
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Alertas sonoros ativados.');

    firstState = 'suspended';
    const refresh = container.querySelector<HTMLButtonElement>('button[title="Atualizar"]');
    await act(async () => {
      refresh?.click();
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Os alertas sonoros foram pausados pelo navegador. Toque para ativá-los novamente.',
    );
    firstState = 'closed';

    unlock = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('ativar os alertas sonoros'));
    expect(unlock).toBeTruthy();

    await act(async () => {
      unlock?.click();
      await flushAsync();
    });

    expect(AudioContextMock).toHaveBeenCalledTimes(2);
    expect(
      toastSuccessMock.mock.calls.filter(([message]) => message === 'Alertas sonoros ativados.'),
    ).toHaveLength(2);
    expect(container.textContent).not.toContain('ativar os alertas sonoros');

    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

});
