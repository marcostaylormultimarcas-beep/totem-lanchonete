import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPendingCheckout } from '../lib/offlineCheckoutQueue';

const STORAGE_KEY = 'visionfood_pending_checkout_v1';
const validProductId = 'a388a70c-fdb3-43c3-9a26-6a468ad2c96a';

const draft = (productId: string, weightKg?: unknown) => ({
  version: 1,
  organizationId: 'e8f9ee01-2f41-4ea6-936a-2e9bcb68e2ae',
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  state: 'submitting',
  createdAt: new Date().toISOString(),
  method: 'cash',
  cart: [{
    id: 'cart-item-1',
    product: {
      id: productId,
      name: 'Teste',
      price: 25,
      category: 'hamburgueres',
      image: '',
      removableIngredients: [],
      extras: [],
    },
    quantity: 1,
    removedIngredients: [],
    selectedExtras: [],
    ...(weightKg === undefined ? {} : { weightKg }),
  }],
  customerName: 'Cliente',
  customerPhone: '',
  customerCpf: '',
  orderType: 'local',
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
  tableToken: '',
  tableLabel: '',
});

describe('loadPendingCheckout recovered cart validation', () => {
  beforeEach(() => localStorage.clear());

  it('keeps a structurally valid recovered checkout', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft(validProductId)));
    expect(loadPendingCheckout('e8f9ee01-2f41-4ea6-936a-2e9bcb68e2ae')).not.toBeNull();
  });

  it('discards an old cart with a non-UUID product id', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft('legacy-product-1')));
    expect(loadPendingCheckout('e8f9ee01-2f41-4ea6-936a-2e9bcb68e2ae')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('discards an invalid recovered weight', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft(validProductId, 'not-a-number')));
    expect(loadPendingCheckout('e8f9ee01-2f41-4ea6-936a-2e9bcb68e2ae')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
