// Vision Tech - Suporte IA (Gemini via Lovable AI Gateway)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BASE_PROMPT = `Você é o assistente virtual inteligente da Vision Food. Tom: prestativo, educado, profissional e amigável. Responda sempre em português do Brasil, objetivo e curto (máx. 6 linhas). Use markdown leve quando útil.

Você ajuda o cliente com QUALQUER dúvida sobre a unidade (loja) usando EXCLUSIVAMENTE as informações reais fornecidas no bloco "DADOS DA LOJA". Se um dado não estiver preenchido, diga educadamente que ainda não foi cadastrado e ofereça outro canal disponível. Nunca invente endereço, telefone, CNPJ ou redes sociais.

Quando o cliente perguntar por horários, localização ou contato → responda com os dados reais. Quando o cliente pedir redes sociais ou contato humano → forneça o link do Instagram e o WhatsApp da unidade de forma amigável e convide a seguir a página. Para WhatsApp use formato https://wa.me/55<DDD+numero> (apenas dígitos). Para Instagram, se vier só o @, monte https://instagram.com/<handle>.

Se a loja estiver "Fechada temporariamente", avise antes de qualquer informação de pedido.`;

const onlyDigits = (s: string) => (s || '').replace(/\D/g, '');

const buildStoreBlock = (org: Record<string, any> | null) => {
  if (!org) {
    return 'DADOS DA LOJA: (contexto não disponível — responda apenas sobre o sistema Vision Food de forma genérica e oriente o cliente a abrir o cardápio da loja).';
  }
  const tel = org.telefone || '';
  const telDigits = onlyDigits(tel);
  const waLink = telDigits ? `https://wa.me/${telDigits.length <= 11 ? '55' + telDigits : telDigits}` : '—';
  const ig = (org.instagram || '').trim();
  const igLink = !ig ? '—' : ig.startsWith('http') ? ig : `https://instagram.com/${ig.replace(/^@/, '')}`;
  const endereco = [
    org.endereco_rua && `${org.endereco_rua}${org.endereco_numero ? ', Nº ' + org.endereco_numero : ''}`,
    org.endereco_bairro && `Bairro ${org.endereco_bairro}`,
    org.city && `${org.city}${org.endereco_estado ? '/' + org.endereco_estado : ''}`,
    org.endereco_cep && `CEP ${org.endereco_cep}`,
  ].filter(Boolean).join(' - ') || '(não cadastrado)';
  return `DADOS DA LOJA (use APENAS estes valores):
- Nome da Loja: ${org.name || '(não cadastrado)'}
- Endereço: ${endereco}
- WhatsApp/Telefone: ${tel || '(não cadastrado)'}  → Link: ${waLink}
- Instagram: ${ig || '(não cadastrado)'}  → Link: ${igLink}
- CNPJ: ${org.cnpj || '(não cadastrado)'}
- Categoria: ${org.categoria || '—'}
- Status Atual: ${org.paused ? 'Fechada temporariamente' : 'Aberta para pedidos'}`;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { messages, org } = await req.json();
    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'messages must be an array' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY ausente' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = `${BASE_PROMPT}\n\n${buildStoreBlock(org)}`;

    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) {
        return new Response(JSON.stringify({ error: 'Limite de requisições atingido. Tente novamente em alguns instantes.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (res.status === 402) {
        return new Response(JSON.stringify({ error: 'Créditos de IA esgotados. Adicione créditos no workspace.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Falha no gateway IA', detail: text }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(res.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
