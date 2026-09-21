import { supabase } from '@/integrations/supabase/client';
import { loadPublicDataWithFallback } from '@/lib/publicCache';

const CACHE_PREFIX = 'visionfood_public_loyalty_config_v1:';

export interface PublicLoyaltyConfig {
  ativo: boolean;
  meta_pedidos: number;
  valor_minimo_pedido: number;
  premio_recompensa: string;
  descricao_premio: string;
  premio_imagem: string;
}

export async function fetchPublicLoyaltyConfig(
  organizationId: string,
): Promise<PublicLoyaltyConfig | null> {
  return loadPublicDataWithFallback<PublicLoyaltyConfig | null>(
    CACHE_PREFIX + organizationId,
    async () => {
      const { data, error } = await supabase.rpc(
        'visionfood_public_loyalty_config',
        { _org: organizationId },
      );
      if (error) throw error;

      const value = (data as any) || {};
      if (!value || Object.keys(value).length === 0) return null;

      return {
        ativo: Boolean(value.ativo),
        meta_pedidos: Number(value.meta_pedidos) || 10,
        valor_minimo_pedido: Number(value.valor_minimo_pedido) || 0,
        premio_recompensa: String(value.premio_recompensa || ''),
        descricao_premio: String(value.descricao_premio || ''),
        premio_imagem: String(value.premio_imagem || ''),
      };
    },
    (value) => value === null || Boolean(value && typeof value === 'object'),
  );
}
