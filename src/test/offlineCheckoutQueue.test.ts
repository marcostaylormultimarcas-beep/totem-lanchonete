import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canQueueOffline, clearPendingCheckout, loadPendingCheckout, savePendingCheckout } from '@/lib/offlineCheckoutQueue';
import { clearKioskCustomerBrowserState, isDeviceOwnedKioskStatus } from '@/lib/kioskDeviceMode';
import { SUPABASE_AUTH_STORAGE_KEY } from '@/config/supabaseConfig';

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

const sessionMemory = new Map<string, string>();
const sessionStorageMock = {
  getItem: vi.fn((key: string) => sessionMemory.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { sessionMemory.set(key, value); }),
  removeItem: vi.fn((key: string) => { sessionMemory.delete(key); }),
  clear: vi.fn(() => sessionMemory.clear()),
  key: vi.fn((index: number) => Array.from(sessionMemory.keys())[index] ?? null),
  get length() { return sessionMemory.size; },
};
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock, configurable: true });

const draft = {
  version: 1 as const,
  organizationId: 'org-a',
  clientRequestId: '00000000-0000-4000-8000-000000000001',
  state: 'queued_offline' as const,
  createdAt: new Date().toISOString(),
  method: 'cash' as const,
  cart: [{
    id: 'cart-item-1',
    product: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Produto válido',
      price: 10,
      category: 'teste',
      image: '',
      removableIngredients: [],
      extras: [],
    },
    quantity: 1,
    removedIngredients: [],
    selectedExtras: [],
  }],
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
  beforeEach(() => { memory.clear(); sessionMemory.clear(); vi.clearAllMocks(); });

  it('persists and restores the same idempotency key and table context', () => {
    savePendingCheckout({
      ...draft,
      companionLocalOrderId: '00000000-0000-4000-8000-000000000003',
      companionClientRequestId: draft.clientRequestId,
    });
    const restored = loadPendingCheckout('org-a');
    expect(restored?.clientRequestId).toBe(draft.clientRequestId);
    expect(restored?.companionClientRequestId).toBe(draft.clientRequestId);
    expect(restored?.companionLocalOrderId).toBe('00000000-0000-4000-8000-000000000003');
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

  it('enables device ownership only for an enrolled companion from the same organization', () => {
    expect(isDeviceOwnedKioskStatus({
      ok: true,
      enrolled: true,
      device_id: '11111111-1111-4111-8111-111111111111',
      organization_id: 'org-a',
    }, 'org-a')).toBe(true);

    expect(isDeviceOwnedKioskStatus({
      ok: true,
      enrolled: true,
      device_id: '11111111-1111-4111-8111-111111111111',
      organization_id: 'org-b',
    }, 'org-a')).toBe(false);
  });

  it('clears customer browser identity without clearing kiosk or public cache state', () => {
    savePendingCheckout(draft);
    localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, 'customer-session');
    localStorage.setItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`, 'verifier');
    localStorage.setItem('pending_coupon', 'CLIENTE10');
    localStorage.setItem('vf_favoritos', '["p1"]');
    localStorage.setItem('fid-seen-org-a-62999999999', '["reward"]');
    localStorage.setItem('kiosk_org_id', 'org-a');
    localStorage.setItem('visionfood_public_catalog_v1:org-a', '{"savedAt":"now","data":[]}');
    sessionStorage.setItem('pending-kiosk-order', '{"customerName":"Anterior"}');

    clearKioskCustomerBrowserState();

    expect(localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`)).toBeNull();
    expect(localStorage.getItem('pending_coupon')).toBeNull();
    expect(localStorage.getItem('vf_favoritos')).toBeNull();
    expect(localStorage.getItem('fid-seen-org-a-62999999999')).toBeNull();
    expect(loadPendingCheckout('org-a')).toBeNull();
    expect(sessionStorage.getItem('pending-kiosk-order')).toBeNull();
    expect(localStorage.getItem('kiosk_org_id')).toBe('org-a');
    expect(localStorage.getItem('visionfood_public_catalog_v1:org-a')).not.toBeNull();
  });
});
