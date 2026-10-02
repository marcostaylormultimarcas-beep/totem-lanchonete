import { supabase } from '@/integrations/supabase/client';
import { loadPublicDataWithFallback } from '@/lib/publicCache';
import type { PublicCatalogProduct } from '@/lib/publicCatalog';

const CACHE_PREFIX = 'visionfood_public_combo_v1:';

export async function fetchPublicCombo(
  organizationId: string,
): Promise<PublicCatalogProduct | null> {
  return loadPublicDataWithFallback<PublicCatalogProduct | null>(
    CACHE_PREFIX + organizationId,
    async () => {
      const { data, error } = await supabase.rpc(
        'visionfood_public_combo' as any,
        { _org: organizationId },
      );
      if (error) throw error;
      const value = data as any;
      if (!value || typeof value !== 'object' || !value.id) return null;
      return value as PublicCatalogProduct;
    },
    (value) => value === null || Boolean(value?.id),
  );
}
