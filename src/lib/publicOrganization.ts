import { supabase } from '@/integrations/supabase/client';
import { loadPublicDataWithFallback, writePublicCache } from '@/lib/publicCache';

const CACHE_PREFIX = 'visionfood_public_organization_v1:';

export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  endereco?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  telefone?: string;
  whatsapp?: string;
  instagram?: string;
  latitude?: number | null;
  longitude?: number | null;
  categoria?: string;
  ativo?: boolean;
  bloqueado?: boolean;
  status?: string;
  paused: boolean;
}

function normalizeSlug(slug?: string | null) {
  return slug?.trim().toLowerCase() || '';
}

function cacheKey(selector: { id?: string | null; slug?: string | null }) {
  if (selector.id) return CACHE_PREFIX + 'id:' + selector.id;
  const slug = normalizeSlug(selector.slug);
  if (slug) return CACHE_PREFIX + 'slug:' + slug;
  return CACHE_PREFIX + 'default';
}

function cacheOrganization(data: PublicOrganization) {
  writePublicCache(CACHE_PREFIX + 'id:' + data.id, data);
  if (data.slug) writePublicCache(CACHE_PREFIX + 'slug:' + normalizeSlug(data.slug), data);
  writePublicCache(CACHE_PREFIX + 'default', data);
}

export async function fetchPublicOrganization(
  selector: { id?: string | null; slug?: string | null } = {},
): Promise<PublicOrganization | null> {
  const key = cacheKey(selector);
  const data = await loadPublicDataWithFallback<PublicOrganization | null>(
    key,
    async () => {
      const { data, error } = await supabase.rpc(
        'visionfood_public_organization',
        {
          _org_id: selector.id || null,
          _slug: selector.slug?.trim() || null,
        },
      );
      if (error) throw error;
      return data ? (data as unknown as PublicOrganization) : null;
    },
    (value) => Boolean(value?.id),
  );

  if (data?.id) cacheOrganization(data);
  return data;
}
