import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canQueueOffline, clearPendingCheckout, loadPendingCheckout, savePendingCheckout } from '@/lib/offlineCheckoutQueue';

const memory = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => memory.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { memory.set(key, value); }),
  removeItem: vi.fn((key: string) => { memory.delete(key); }),
  clear: vi.fn(() => memory.clear()),
  key: vi.fn((index: number) => Array.from(memory.keys())[index] ?? null),
  get length() { return memory.size; },
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });

const draft = {
  version: 1 as const,
  organizationId: 'org-a',
  clientRequestId: '00000000-0000-4000-8000-000000000001',
  state: 'queued_offline' as const,
  createdAt: new Date().toISOString(),
  method: 'cash' as const,
  cart: [],
  customerName: 'Cliente',
  customerPhone: '62999999999',
  customerCpf: '',
  orderType: 'local' as const,
  deliveryAddress: '',
  deliveryReference: '',
  deliveryRecipient: '',
  bairroId: '',
  bairroNome: '',
  bairroTaxa: 0,
  bairroTempo: 0,
  deliveryCep: '',
  appliedCoupon: null,
  scheduledFor: null,
  tableToken: '00000000-0000-4000-8000-000000000002',
  tableLabel: 'Mesa 12',
};

describe('offlineCheckoutQueue', () => {
  beforeEach(() => { memory.clear(); vi.clearAllMocks(); });

  it('persists and restores the same idempotency key and table context', () => {
    savePendingCheckout(draft);
    const restored = loadPendingCheckout('org-a');
    expect(restored?.clientRequestId).toBe(draft.clientRequestId);
    expect(restored?.tableToken).toBe(draft.tableToken);
    expect(restored?.tableLabel).toBe('Mesa 12');
    expect(restored?.state).toBe('queued_offline');
  });

  it('does not expose another organization pending checkout', () => {
    savePendingCheckout(draft);
    expect(loadPendingCheckout('org-b')).toBeNull();
  });

  it('clears only the matching checkout request', () => {
    savePendingCheckout(draft);
    clearPendingCheckout('different-request');
    expect(loadPendingCheckout('org-a')).not.toBeNull();
    clearPendingCheckout(draft.clientRequestId);
    expect(loadPendingCheckout('org-a')).toBeNull();
  });

  it('queues only cash while offline', () => {
    expect(canQueueOffline('cash')).toBe(true);
    expect(canQueueOffline('pix')).toBe(false);
    expect(canQueueOffline('terminal')).toBe(false);
    expect(canQueueOffline('online')).toBe(false);
    expect(canQueueOffline(null)).toBe(false);
  });
});
