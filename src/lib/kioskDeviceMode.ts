import { SUPABASE_AUTH_STORAGE_KEY } from '@/config/supabaseConfig';
import { clearPendingCheckout } from '@/lib/offlineCheckoutQueue';

export interface KioskCompanionStatus {
  ok?: boolean;
  enrolled?: boolean;
  device_id?: string | null;
  organization_id?: string | null;
}

export function isDeviceOwnedKioskStatus(
  status: KioskCompanionStatus | null | undefined,
  organizationId: string | null | undefined,
) {
  return Boolean(
    organizationId &&
    status?.ok === true &&
    status?.enrolled === true &&
    status.organization_id === organizationId &&
    status.device_id,
  );
}

/**
 * Shared physical kiosks must not inherit browser identity or customer-only UI
 * state from the previous person. Device identity/queue files live in the local
 * companion and are intentionally NOT touched here.
 */
export function clearKioskCustomerBrowserState() {
  if (typeof localStorage !== 'undefined') {
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (
          key === SUPABASE_AUTH_STORAGE_KEY ||
          key.startsWith(`${SUPABASE_AUTH_STORAGE_KEY}-`) ||
          key === 'pending_coupon' ||
          key === 'vf_favoritos' ||
          key.startsWith('fid-seen-')
        ) {
          localStorage.removeItem(key);
        }
      }
      clearPendingCheckout();
    } catch {
      // Storage cleanup is best-effort; device checkout never consumes customer auth.
    }
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem('pending-kiosk-order');
    } catch {
      // ignore unavailable sessionStorage
    }
  }
}
