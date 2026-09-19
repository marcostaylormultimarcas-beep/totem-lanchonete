import { supabase } from '@/integrations/supabase/client';

export interface PublicCalledTicket {
  id: string;
  numero: string;
  tipo: string;
  called_at: string;
}

export async function fetchPublicCalledTickets(
  organizationId: string,
  limit = 5,
): Promise<PublicCalledTicket[]> {
  const { data, error } = await supabase.rpc(
    'visionfood_public_called_tickets',
    { _org: organizationId, _limit: limit },
  );

  if (error) throw error;
  return Array.isArray(data) ? (data as unknown as PublicCalledTicket[]) : [];
}
