import { supabase } from '@/integrations/supabase/client';

const CACHE_PREFIX = 'visionfood_public_storefront_v1:';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readCachedStorefront(organizationId: string): PublicStorefrontConfig | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${organizationId}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { savedAt?: string; data?: PublicStorefrontConfig };
    const age = Date.now() - new Date(cached.savedAt || '').getTime();
    if (!Number.isFinite(age) || age > CACHE_MAX_AGE_MS || !cached.data) {
      localStorage.removeItem(`${CACHE_PREFIX}${organizationId}`);
      return null;
    }
    return cached.data;
  } catch {
    return null;
  }
}

function writeCachedStorefront(organizationId: string, data: PublicStorefrontConfig) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      `${CACHE_PREFIX}${organizationId}`,
      JSON.stringify({ savedAt: new Date().toISOString(), data }),
    );
  } catch {
    // Public configuration can continue online without browser cache.
  }
}

export interface PublicStorefrontConfig {
  organization_id?: string;
  store_name?: string;
  whatsapp_number?: string;
  share_image?: string;
  combo?: unknown;
  banners?: unknown;
  instagram_url?: string;
  categories?: unknown;
  category_icons?: unknown;
  delivery_enabled?: boolean;
  business_hours?: unknown;
  emergency_closed?: boolean;
  closed_message?: string;
  scheduling_enabled?: boolean;
  balanca_baud_rate?: number;
  delivery_tempo_base_min?: number;
  delivery_mode?: 'bairros' | 'raio_km' | 'lista_ceps';
  updated_at?: string | null;
}

export async function fetchPublicStorefrontConfig(
  organizationId: string,
): Promise<PublicStorefrontConfig> {
  try {
    const { data, error } = await supabase.rpc(
      'visionfood_public_storefront_config',
      { _org: organizationId },
    );

    if (error) throw error;
    const config = ((data as unknown) || {}) as PublicStorefrontConfig;
    writeCachedStorefront(organizationId, config);
    return config;
  } catch (error) {
    const cached = readCachedStorefront(organizationId);
    if (cached) return cached;
    throw error;
  }
}
