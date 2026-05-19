// Edge function pública: gera uma cobrança Pix real no Mercado Pago
// usando o Access Token configurado pela loja em `settings.mp_access_token`.
//
// Entrada (POST JSON):
//   { organization_id: uuid, amount: number, description?: string, payer_email?: string }
//
// Saída:
//   { ok: true, qr_code_base64, qr_code, ticket_url, payment_id, amount }
//
// Como o totem público (sem login) também precisa gerar Pix, esta função
// não exige JWT. A leitura do token usa o service role apenas para
// acessar a coluna `mp_access_token` da loja indicada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const organization_id = String(body.organization_id || "");
    const amountNum = Number(body.amount);
    const description = String(body.description || "Pedido Vision Mídia").slice(0, 200);
    const payer_email = String(body.payer_email || "cliente@visionmidia.com").slice(0, 120);

    if (!organization_id || !Number.isFinite(amountNum) || amountNum <= 0) {
      return new Response(JSON.stringify({ error: "Parâmetros inválidos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: settings, error: sErr } = await admin
      .from("settings")
      .select("mp_access_token, store_name")
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (sErr || !settings?.mp_access_token) {
      return new Response(JSON.stringify({ error: "Loja sem Mercado Pago configurado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const idempotencyKey = crypto.randomUUID();

    const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.mp_access_token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: Math.round(amountNum * 100) / 100,
        description,
        payment_method_id: "pix",
        payer: { email: payer_email },
      }),
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error("Mercado Pago error:", mpData);
      return new Response(
        JSON.stringify({ error: mpData?.message || "Falha ao gerar Pix no Mercado Pago", details: mpData }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tx = mpData.point_of_interaction?.transaction_data;
    return new Response(
      JSON.stringify({
        ok: true,
        payment_id: mpData.id,
        amount: mpData.transaction_amount,
        qr_code_base64: tx?.qr_code_base64 || "",
        qr_code: tx?.qr_code || "",
        ticket_url: tx?.ticket_url || "",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("mercadopago-create-pix exception:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
