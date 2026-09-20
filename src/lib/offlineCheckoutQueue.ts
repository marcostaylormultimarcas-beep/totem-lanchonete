import type { CartItem } from '@/data/store';
import type { AppliedCoupon } from '@/components/kiosk/CartScreen';

const STORAGE_KEY = 'visionfood_pending_checkout_v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type CheckoutMethod = 'pix' | 'cash' | 'terminal' | 'online';
export type PendingCheckoutState = 'submitting' | 'queued_offline';

export interface PendingCheckoutDraft {
  version: 1;
  organizationId: string;
  clientRequestId: string;
  state: PendingCheckoutState;
  createdAt: string;
  method: CheckoutMethod;
  cart: CartItem[];
  customerName: string;
  customerPhone: string;
  customerCpf: string;
  orderType: 'local' | 'viagem';
  deliveryAddress: string;
  deliveryReference: string;
  deliveryRecipient: string;
  bairroId: string;
  bairroNome: string;
  bairroTaxa: number;
  bairroTempo: number;
  deliveryCep: string;
  appliedCoupon: AppliedCoupon | null;
  scheduledFor: string | null;
  tableToken: string;
  tableLabel: string;
}

export function loadPendingCheckout(organizationId?: string | null): PendingCheckoutDraft | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCheckoutDraft;
    if (
      parsed?.version !== 1 ||
      !parsed.organizationId ||
      !parsed.clientRequestId ||
      !parsed.createdAt ||
      !parsed.method ||
      !Array.isArray(parsed.cart)
    ) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const age = Date.now() - new Date(parsed.createdAt).getTime();
    if (!Number.isFinite(age) || age > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (organizationId && parsed.organizationId !== organizationId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePendingCheckout(draft: PendingCheckoutDraft) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

export function clearPendingCheckout(clientRequestId?: string) {
  if (typeof localStorage === 'undefined') return;
  if (!clientRequestId) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  const current = loadPendingCheckout();
  if (current?.clientRequestId === clientRequestId) localStorage.removeItem(STORAGE_KEY);
}

export function createClientRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  throw new Error('Este navegador não oferece geração segura de identificador para o pedido.');
}

export function canQueueOffline(method: CheckoutMethod | null) {
  return method === 'cash';
}
