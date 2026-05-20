// Vision Tech - CRM: gerador de mensagens de retenção via Lovable AI Gateway
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OBJETIVOS: Record<string, string> = {
  recuperar: 'Reativar um cliente inativo de forma calorosa, lembrando dele e oferecendo um motivo para voltar.',
  promocao: 'Comunicar uma promoção/desconto especial para incentivar uma nova compra.',
  novidade: 'Comunicar um novo produto/cardápio para despertar curiosidade.',
  aniversario: 'Felicitar o cliente e oferecer um mimo de aniversário.',
  feedback: 'Pedir um feedback amigável e curto sobre a última experiência.',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { objetivo, cliente, loja, dias_inativo, ultimo_pedido_total, extras } = await req.json();
    const objetivoDesc = OBJETIVOS[objetivo as string] || OBJETIVOS.recuperar;

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY ausente' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const system = `Você escreve mensagens de WhatsApp curtas (máx. 3 linhas), em português do Brasil, tom humano e gentil, sem emojis em excesso (máx. 2). Não use markdown. Não use aspas. Comece pelo primeiro nome do cliente. Inclua o nome da loja quando fizer sentido. Termine com uma chamada para ação clara.`;

    const user = `Objetivo: ${objetivoDesc}
Loja: ${loja || 'nossa loja'}
Cliente: ${cliente || 'amigo(a)'}
Dias sem comprar: ${dias_inativo ?? 'desconhecido'}
Último pedido: ${ultimo_pedido_total ? `R$ ${Number(ultimo_pedido_total).toFixed(2)}` : 'sem histórico'}
${extras ? `Contexto extra: ${extras}` : ''}

Gere APENAS o texto da mensagem, sem explicações.`;

    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) return new Response(JSON.stringify({ error: 'Limite de requisições atingido. Tente novamente em alguns instantes.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (res.status === 402) return new Response(JSON.stringify({ error: 'Créditos de IA esgotados. Adicione créditos no workspace.' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ error: 'Falha no gateway IA', detail: text }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const data = await res.json();
    const message = data?.choices?.[0]?.message?.content?.trim?.() || '';
    return new Response(JSON.stringify({ ok: true, message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
