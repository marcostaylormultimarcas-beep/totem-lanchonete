// Webhook do Mercado Pago — atualiza status_assinatura conforme eventos de preapproval/payment
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const url = new URL(req.url);
    const qpType = url.searchParams.get('type') || url.searchParams.get('topic') || '';
    const qpId = url.searchParams.get('id') || url.searchParams.get('data.id') || '';
    let body: any = {};
    try { body = await req.json(); } catch { /* algumas notificações vêm sem body */ }

    const type = body?.type || body?.topic || qpType;
    const dataId = body?.data?.id || body?.id || qpId;
    console.log('MP webhook', { type, dataId });

    if (!type || !dataId) {
      return new Response('ok', { headers: corsHeaders });
    }

    const { data: tokenData } = await admin.rpc('get_master_mp_token_internal' as any);
    const mpToken = tokenData as string | null;
    if (!mpToken) {
      console.warn('Sem token master configurado');
      return new Response('ok', { headers: corsHeaders });
    }

    const mpFetch = async (path: string) => {
      const r = await fetch(`https://api.mercadopago.com${path}`, {
        headers: { Authorization: `Bearer ${mpToken}` },
      });
      return r.ok ? r.json() : null;
    };

    // Map status MP → status interno
    const mapStatus = (s: string): 'ativo' | 'pendente' | 'inadimplente' | 'cancelado' => {
      const v = (s || '').toLowerCase();
      if (v === 'authorized' || v === 'approved') return 'ativo';
      if (v === 'pending' || v === 'in_process') return 'pendente';
      if (v === 'cancelled' || v === 'canceled') return 'cancelado';
      // paused / rejected / charged_back / expired
      return 'inadimplente';
    };

    let preapprovalId: string | null = null;
    let nextChargeAt: string | null = null;
    let newStatus: string | null = null;

    if (String(type).includes('preapproval')) {
      const sub = await mpFetch(`/preapproval/${dataId}`);
      if (sub) {
        preapprovalId = sub.id;
        newStatus = mapStatus(sub.status);
        nextChargeAt = sub.next_payment_date || sub.auto_recurring?.next_payment_date || null;
      }
    } else if (String(type).includes('payment')) {
      const pay = await mpFetch(`/v1/payments/${dataId}`);
      if (pay) {
        preapprovalId = pay.metadata?.preapproval_id || pay.preapproval_id || null;
        const payStatus = (pay.status || '').toLowerCase();
        if (payStatus === 'approved') newStatus = 'ativo';
        else if (payStatus === 'pending' || payStatus === 'in_process') newStatus = 'pendente';
        else newStatus = 'inadimplente';
      }
    }

    if (!preapprovalId || !newStatus) {
      return new Response('ok', { headers: corsHeaders });
    }

    const update: Record<string, any> = { status_assinatura: newStatus };
    if (nextChargeAt) update.mp_next_charge_at = nextChargeAt;

    const { error } = await admin
      .from('organizations')
      .update(update)
      .eq('mp_subscription_id', preapprovalId);
    if (error) console.error('update org error', error);

    return new Response('ok', { headers: corsHeaders });
  } catch (e) {
    console.error(e);
    return new Response('ok', { headers: corsHeaders });
  }
});
