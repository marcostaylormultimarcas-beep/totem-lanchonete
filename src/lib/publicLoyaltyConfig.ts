import { supabase } from '@/integrations/supabase/client';
import { loadPublicDataWithFallback } from '@/lib/publicCache';

const CACHE_PREFIX = 'visionfood_public_loyalty_config_v2:';

export interface PublicLoyaltyReward {
  id: string;
  title: string;
  description: string;
  image_url: string;
  points_cost: number;
  reward_type: 'benefit' | 'product';
  product_id: string | null;
}

export interface PublicLoyaltyConfig {
  ativo: boolean;
  earning_mode: 'spend' | 'order';
  points_per_real: number;
  points_per_order: number;
  valor_minimo_pedido: number;
  meta_pedidos: number;
  premio_recompensa: string;
  descricao_premio: string;
  premio_imagem: string;
  rewards: PublicLoyaltyReward[];
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

      const rewards = Array.isArray(value.rewards)
        ? value.rewards.map((reward: any) => ({
            id: String(reward.id || ''),
            title: String(reward.title || 'Prêmio'),
            description: String(reward.description || ''),
            image_url: String(reward.image_url || ''),
            points_cost: Math.max(1, Number(reward.points_cost) || 1),
            reward_type: reward.reward_type === 'product' ? 'product' as const : 'benefit' as const,
            product_id: reward.product_id ? String(reward.product_id) : null,
          })).filter((reward: PublicLoyaltyReward) => Boolean(reward.id))
        : [];

      return {
        ativo: Boolean(value.ativo),
        earning_mode: value.earning_mode === 'order' ? 'order' : 'spend',
        points_per_real: Math.max(0.01, Number(value.points_per_real) || 1),
        points_per_order: Math.max(1, Number(value.points_per_order) || 1),
        valor_minimo_pedido: Math.max(0, Number(value.valor_minimo_pedido) || 0),
        meta_pedidos: Math.max(1, Number(value.meta_pedidos) || 10),
        premio_recompensa: String(value.premio_recompensa || ''),
        descricao_premio: String(value.descricao_premio || ''),
        premio_imagem: String(value.premio_imagem || ''),
        rewards,
      };
    },
    (value) => value === null || Boolean(value && typeof value === 'object'),
  );
}
