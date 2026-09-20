import { supabase } from '@/integrations/supabase/client';
import { loadPublicDataWithFallback } from '@/lib/publicCache';

const CACHE_PREFIX = 'visionfood_public_theme_v1:';

export interface PublicThemeSnapshot {
  primary_color?: string;
  secondary_color?: string;
  mode?: 'dark' | 'light' | string;
}

export async function fetchPublicTheme(organizationId: string): Promise<PublicThemeSnapshot> {
  return loadPublicDataWithFallback<PublicThemeSnapshot>(
    CACHE_PREFIX + organizationId,
    async () => {
      const { data, error } = await supabase.rpc('visionfood_public_theme', { _org: organizationId });
      if (error) throw error;
      return ((data as unknown) || {}) as PublicThemeSnapshot;
    },
    (value) => Boolean(value && typeof value === 'object'),
  );
}
