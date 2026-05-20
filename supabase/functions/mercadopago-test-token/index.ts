// Testa um Access Token do Mercado Pago chamando GET /users/me.
// Aceita um token "cru" enviado no body (para validar antes de salvar)
// OU um organization_id (lê o token criptografado do Vault via RPC service_role).
//
// Body JSON: { access_token?: string, organization_id?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    let token = String(body.access_token || "").trim();
    const organization_id = String(body.organization_id || "").trim();

    if (!token && organization_id) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data, error } = await admin.rpc("get_mp_access_token_internal", { _org: organization_id });
      if (error) {
        return new Response(JSON.stringify({ ok: false, error: "Falha ao ler credenciais da loja" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      token = String(data || "").trim();
    }

    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: "Token não informado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const r = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json().catch(() => ({} as any));

    if (!r.ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: data?.message || "Token inválido",
        status: r.status,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      ok: true,
      account: {
        id: data?.id,
        nickname: data?.nickname,
        email: data?.email,
        site_id: data?.site_id,
        country_id: data?.country_id,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
