import { supabase } from '@/integrations/supabase/client';

const CACHE_PREFIX = 'visionfood_public_catalog_v1:';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readCachedCatalog(organizationId: string): PublicCatalogProduct[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${organizationId}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { savedAt?: string; data?: PublicCatalogProduct[] };
    const age = Date.now() - new Date(cached.savedAt || '').getTime();
    if (!Number.isFinite(age) || age > CACHE_MAX_AGE_MS || !Array.isArray(cached.data)) {
      localStorage.removeItem(`${CACHE_PREFIX}${organizationId}`);
      return null;
    }
    return cached.data;
  } catch {
    return null;
  }
}

function writeCachedCatalog(organizationId: string, data: PublicCatalogProduct[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      `${CACHE_PREFIX}${organizationId}`,
      JSON.stringify({ savedAt: new Date().toISOString(), data }),
    );
  } catch {
    // The online catalog remains authoritative when browser storage is unavailable.
  }
}

export interface PublicCatalogProduct {
  id: string;
  name: string;
  price: number;
  category: string;
  image?: string | null;
  removable_ingredients?: string[];
  extras?: Array<{ name: string; price: number }>;
  is_combo?: boolean;
  ingredients?: string[];
  description?: string;
  organization_id: string;
  available: boolean;
  codigo_barras?: string;
  sold_by_weight?: boolean;
  prep_time_min?: number;
}

export async function fetchPublicCatalog(
  organizationId: string,
): Promise<PublicCatalogProduct[]> {
  try {
    const { data, error } = await supabase.rpc(
      'visionfood_public_catalog',
      { _org: organizationId },
    );

    if (error) throw error;
    const catalog = Array.isArray(data) ? (data as unknown as PublicCatalogProduct[]) : [];
    writeCachedCatalog(organizationId, catalog);
    return catalog;
  } catch (error) {
    const cached = readCachedCatalog(organizationId);
    if (cached) return cached;
    throw error;
  }
}
