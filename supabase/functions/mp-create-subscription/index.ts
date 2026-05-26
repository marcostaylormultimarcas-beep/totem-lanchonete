// Cria uma assinatura recorrente (preapproval) no Mercado Pago para a loja
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: cerr } = await userClient.auth.getClaims(token);
    if (cerr || !claims?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }
    const userId = claims.claims.sub as string;
    const email = (claims.claims.email as string) || '';

    const body = await req.json().catch(() => ({}));
    const organizationId = body.organization_id as string | undefined;
    if (!organizationId) {
      return new Response(JSON.stringify({ error: 'organization_id obrigatório' }), { status: 400, headers: corsHeaders });
    }

    // Verifica posse
    const { data: org } = await admin
      .from('organizations')
      .select('id, name, owner_id, master_id, status_assinatura')
      .eq('id', organizationId)
      .maybeSingle();
    if (!org) return new Response(JSON.stringify({ error: 'Loja não encontrada' }), { status: 404, headers: corsHeaders });
    if (org.owner_id !== userId && org.master_id !== userId) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: corsHeaders });
    }

    // Valor + token master
    const { data: sys } = await admin
      .from('system_settings')
      .select('valor_plano_padrao')
      .eq('id', 'global')
      .maybeSingle();
    const valor = Number(sys?.valor_plano_padrao ?? 197);

    const { data: tokenData } = await admin.rpc('get_master_mp_token_internal' as any);
    const mpToken = tokenData as string | null;
    if (!mpToken) {
      return new Response(JSON.stringify({ error: 'Chave Mercado Pago Master não configurada' }), {
        status: 400, headers: corsHeaders,
      });
    }

    const origin = req.headers.get('origin') || req.headers.get('referer') || '';
    const backUrl = `${origin.replace(/\/$/, '')}/admin?subscription=ok`;

    const externalRef = `org_${organizationId}`;
    const payload = {
      reason: `Assinatura VisionFood - ${org.name}`,
      external_reference: externalRef,
      payer_email: email,
      back_url: backUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: Number(valor.toFixed(2)),
        currency_id: 'BRL',
      },
      status: 'pending',
    };

    const resp = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mpToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('MP error', data);
      return new Response(JSON.stringify({ error: data?.message || 'Falha MP', detail: data }), {
        status: 400, headers: corsHeaders,
      });
    }

    // Salva id/valor + status pendente
    await admin
      .from('organizations')
      .update({
        mp_subscription_id: data.id,
        mp_subscription_amount: valor,
        status_assinatura: 'pendente',
      })
      .eq('id', organizationId);

    return new Response(
      JSON.stringify({
        ok: true,
        init_point: data.init_point || data.sandbox_init_point,
        subscription_id: data.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: corsHeaders,
    });
  }
});
