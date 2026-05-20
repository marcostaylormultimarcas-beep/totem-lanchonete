// Vision Tech - Suporte IA (Gemini via Lovable AI Gateway)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `CONTEXTO DO SISTEMA: Você é o suporte da Vision Lanchonete, parte do grupo Vision Tech. Tom: prestativo, profissional e técnico. Responda sempre em português do Brasil, de forma objetiva e curta (máx. 6 linhas). Use a base de conhecimento abaixo como fonte primária. Se a pergunta fugir do escopo, oriente o usuário a abrir um chamado com o suporte humano.

BASE DE CONHECIMENTO (FAQ):
1) O que é o sistema? Ecossistema completo: Totem de autoatendimento, KDS (cozinha), Programa de Fidelidade e automação fiscal — tudo em nuvem.
2) Como configurar a Maquininha? Integrada via API Mercado Pago. Verifique pareamento Bluetooth/USB, conexão de internet e se o Terminal ID está cadastrado em Configurações > Pagamentos.
3) Como ativar a Nota Fiscal? Painel do Lojista > Configurações Fiscais > ativar o toggle e preencher CNPJ, Razão Social, IE, Regime, CSC e Token Fiscal.
4) Modelo de licenciamento: Licenças Master (parceiros regionais) e Super Master (Vision Tech, dono da plataforma). Status "Pausado" bloqueia o acesso da loja imediatamente.
5) Offline: O foco é nuvem. Em queda de internet, recomendamos um roteador 4G de backup ao lado do totem.
6) Segurança: Banco protegido com Supabase RLS. Cada loja só enxerga seus próprios dados — isolamento total por ID da organização.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { messages } = await req.json();
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

    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
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
