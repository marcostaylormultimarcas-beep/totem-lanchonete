import { supabase } from '@/integrations/supabase/client';
import { loadPublicDataWithFallback } from '@/lib/publicCache';

const CACHE_PREFIX = 'visionfood_public_catalog_v2:';

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
  return loadPublicDataWithFallback<PublicCatalogProduct[]>(
    CACHE_PREFIX + organizationId,
    async () => {
      const { data, error } = await supabase.rpc(
        'visionfood_public_catalog',
        { _org: organizationId },
      );
      if (error) throw error;
      return Array.isArray(data) ? (data as unknown as PublicCatalogProduct[]) : [];
    },
    Array.isArray,
  );
}
