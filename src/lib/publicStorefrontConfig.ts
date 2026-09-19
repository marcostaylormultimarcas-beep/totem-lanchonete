import { supabase } from '@/integrations/supabase/client';

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
  const { data, error } = await supabase.rpc(
    'visionfood_public_storefront_config',
    { _org: organizationId },
  );

  if (error) throw error;
  return ((data as unknown) || {}) as PublicStorefrontConfig;
}
