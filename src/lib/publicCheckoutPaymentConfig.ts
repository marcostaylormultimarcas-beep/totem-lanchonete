import { supabase } from '@/integrations/supabase/client';
import { loadPublicDataWithFallback } from '@/lib/publicCache';

const CACHE_PREFIX = 'visionfood_checkout_payment_config_v1:';

export interface PublicCheckoutPaymentConfig {
  ok?: boolean;
  store_name?: string;
  whatsapp_number?: string;
  pix_key_manual?: string;
  pay_cash_enabled?: boolean;
  pay_pix_enabled?: boolean;
  pay_card_terminal_enabled?: boolean;
  pay_card_online_enabled?: boolean;
  mp_terminal_id?: string;
  [key: string]: unknown;
}

export async function fetchPublicCheckoutPaymentConfig(
  organizationId: string,
): Promise<PublicCheckoutPaymentConfig> {
  return loadPublicDataWithFallback<PublicCheckoutPaymentConfig>(
    CACHE_PREFIX + organizationId,
    async () => {
      const { data, error } = await supabase.rpc('visionfood_checkout_payment_config', { _org: organizationId });
      const config = ((data as unknown) || {}) as PublicCheckoutPaymentConfig;
      if (error) throw error;
      if (!config?.ok) throw new Error('public_payment_config_unavailable');
      return config;
    },
    (value) => Boolean(value?.ok),
  );
}
