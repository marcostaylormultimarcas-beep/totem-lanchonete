import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { app_id, api_key } = await req.json();
    if (!app_id || !api_key) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Informe App ID e REST API Key.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    // Chamada real à API do OneSignal para validar as credenciais
    const res = await fetch(
      `https://api.onesignal.com/notifications?app_id=${encodeURIComponent(app_id)}&limit=1`,
      { headers: { Authorization: `Basic ${api_key}`, Accept: 'application/json' } },
    );
    if (res.status === 200) {
      return new Response(JSON.stringify({ valid: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const txt = await res.text();
    let msg = 'Credenciais inválidas no OneSignal.';
    try {
      const j = JSON.parse(txt);
      msg = j?.errors?.[0] || j?.error || msg;
    } catch {}
    return new Response(JSON.stringify({ valid: false, error: msg, status: res.status }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ valid: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
