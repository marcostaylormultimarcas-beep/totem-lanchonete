import { createClient } from 'npm:@supabase/supabase-js@2.101.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OBJETIVOS: Record<string, string> = {
  recuperar: 'Reativar um cliente inativo de forma calorosa e objetiva.',
  promocao: 'Comunicar uma promoção de forma clara, sem pressão excessiva.',
  novidade: 'Apresentar uma novidade do cardápio para despertar interesse.',
  aniversario: 'Felicitar o cliente e convidá-lo a voltar.',
  feedback: 'Pedir um feedback curto sobre a última experiência.',
};

const fallbackMessage = (objective: string, name: string, store: string, days: number | null, extras: string) => {
  const firstName = (name || 'Cliente').trim().split(/\s+/)[0] || 'Cliente';
  const loja = store?.trim() || 'nossa loja';
  const extra = extras?.trim() ? ` ${extras.trim()}` : '';

  if (objective === 'promocao') return `${firstName}, temos uma condição especial na ${loja} e lembramos de você.${extra} Quer que eu te envie os detalhes?`;
  if (objective === 'novidade') return `${firstName}, chegou novidade na ${loja} que pode combinar com você.${extra} Quer conferir?`;
  if (objective === 'aniversario') return `${firstName}, feliz aniversário! A equipe da ${loja} deseja um ótimo dia.${extra} Quando quiser, será um prazer receber você novamente.`;
  if (objective === 'feedback') return `${firstName}, aqui é da ${loja}. Queremos melhorar sempre: como foi sua última experiência com a gente?`;
  const inactive = days != null ? ` Já faz ${days} dias desde sua última compra.` : '';
  return `${firstName}, sentimos sua falta na ${loja}!${inactive}${extra} Quer voltar a pedir com a gente?`;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return new Response(JSON.stringify({ error: 'unauthenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'unauthenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const orgId = String(body?.organization_id || '');
    const contactId = String(body?.contact_id || '');
    const objetivo = String(body?.objetivo || 'recuperar');
    const extras = String(body?.extras || '').slice(0, 500);
    const store = String(body?.loja || '').slice(0, 120);

    if (!orgId || !contactId) {
      return new Response(JSON.stringify({ error: 'invalid_request' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: canManage, error: manageError } = await supabase.rpc('crm_can_manage' as any, { _org: orgId });
    if (manageError || canManage !== true) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: contact, error: contactError } = await supabase
      .from('crm_contacts' as any)
      .select('id,name,last_purchase_at,last_order_total,confirmed_orders,confirmed_revenue,consent_status')
      .eq('id', contactId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (contactError || !contact) {
      return new Response(JSON.stringify({ error: 'contact_not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if ((contact as any).consent_status === 'opt_out' && ['recuperar','promocao','novidade','aniversario'].includes(objetivo)) {
      return new Response(JSON.stringify({ error: 'marketing_opt_out' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const lastPurchaseAt = (contact as any).last_purchase_at ? new Date((contact as any).last_purchase_at).getTime() : null;
    const daysInactive = lastPurchaseAt ? Math.max(0, Math.floor((Date.now() - lastPurchaseAt) / 86400000)) : null;
    const fallback = fallbackMessage(objetivo, (contact as any).name, store, daysInactive, extras);

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: true, message: fallback, generated_by: 'template' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const objectiveDesc = OBJETIVOS[objetivo] || OBJETIVOS.recuperar;
    const system = 'Você escreve mensagens curtas de WhatsApp em português do Brasil, no máximo 3 linhas, tom humano e profissional, sem markdown, sem pressão e com no máximo 2 emojis. Não invente descontos, cupons ou benefícios. Termine com uma chamada para ação simples.';
    const prompt = `Objetivo: ${objectiveDesc}
Loja: ${store || 'nossa loja'}
Cliente: ${(contact as any).name || 'Cliente'}
Dias desde a última compra confirmada: ${daysInactive ?? 'sem compra confirmada'}
Valor da última compra confirmada: R$ ${Number((contact as any).last_order_total || 0).toFixed(2)}
Compras confirmadas: ${Number((contact as any).confirmed_orders || 0)}
${extras ? `Contexto autorizado pelo lojista: ${extras}` : ''}

Gere apenas a mensagem.`;

    try {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (response.ok) {
        const ai = await response.json();
        const message = ai?.choices?.[0]?.message?.content?.trim?.();
        if (message) {
          return new Response(JSON.stringify({ ok: true, message, generated_by: 'ai' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    } catch {
      // A geração por IA é opcional; o CRM continua operacional com template seguro.
    }

    return new Response(JSON.stringify({ ok: true, message: fallback, generated_by: 'template' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
