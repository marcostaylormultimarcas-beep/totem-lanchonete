import { supabase } from '@/integrations/supabase/client';
import { loadPublicDataWithFallback } from '@/lib/publicCache';

const CACHE_PREFIX = 'visionfood_public_delivery_areas_v1:';

export interface PublicDeliveryArea {
  id: string;
  nome_bairro: string;
  valor_taxa: number;
  tempo_estimado: number;
  ativo: boolean;
  [key: string]: unknown;
}

export async function fetchPublicDeliveryAreas(
  organizationId: string,
): Promise<PublicDeliveryArea[]> {
  return loadPublicDataWithFallback<PublicDeliveryArea[]>(
    CACHE_PREFIX + organizationId,
    async () => {
      const { data, error } = await supabase.rpc('visionfood_public_delivery_areas', { _org: organizationId });
      if (error) throw error;
      return Array.isArray(data) ? (data as unknown as PublicDeliveryArea[]) : [];
    },
    Array.isArray,
  );
}
