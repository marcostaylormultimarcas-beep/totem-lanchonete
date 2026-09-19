import { supabase } from '@/integrations/supabase/client';

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

export async function fetchPublicOrganization(
  selector: { id?: string | null; slug?: string | null } = {},
): Promise<PublicOrganization | null> {
  const { data, error } = await supabase.rpc(
    'visionfood_public_organization',
    {
      _org_id: selector.id || null,
      _slug: selector.slug?.trim() || null,
    },
  );

  if (error) throw error;
  return data ? (data as unknown as PublicOrganization) : null;
}
