import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const intentId = String(body.intent_id || "").trim();
    const sessionToken = String(body.session_token || "").trim();
    const payerEmail = String(body.payer_email || "cliente@visionmidia.com").slice(0, 120);
    if (!intentId || !sessionToken) return json({ error: "Intent ou sessão ausente" }, 400);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "Configuração interna indisponível" }, 500);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // Atomic claim validates the PDV session, ownership, expiration and one-time use.
    // The browser cannot choose organization or amount anymore.
    const { data: claimData, error: claimErr } = await admin.rpc("pdv_claim_pix_intent_internal", {
      _intent_id: intentId,
      _session_token: sessionToken,
    });
    const claim = claimData as any;
    if (claimErr || !claim?.ok) {
      console.error("PIX intent claim failed:", claimErr?.message || claim?.reason || "unknown");
      return json({ error: "Intent PIX inválido ou expirado" }, 403);
    }

    const organizationId = String(claim.organization_id || "");
    const amount = Number(claim.amount);
    if (!organizationId || !Number.isFinite(amount) || amount <= 0) return json({ error: "Intent PIX inválido" }, 400);

    const { data: tokenData, error: tokenErr } = await admin.rpc("get_mp_access_token_internal", { _org: organizationId });
    if (tokenErr) {
      console.error("Vault RPC error:", tokenErr.message);
      return json({ error: "Falha ao ler credenciais da loja" }, 500);
    }
    const accessToken = (tokenData as string | null) || "";
    if (!accessToken) return json({ error: "Loja sem Mercado Pago configurado" }, 400);

    const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": intentId,
      },
      body: JSON.stringify({
        transaction_amount: Math.round(amount * 100) / 100,
        description: `PDV VisionFood ${String(claim.org_name || "")}`.slice(0, 200),
        payment_method_id: "pix",
        payer: { email: payerEmail },
        external_reference: `pdv_pix_intent:${intentId}`,
      }),
    });
    const mpData = await mpRes.json();
    if (!mpRes.ok) {
      console.error("Mercado Pago error:", mpData?.message || mpRes.status);
      return json({ error: mpData?.message || "Falha ao gerar Pix no Mercado Pago" }, 502);
    }

    const tx = mpData.point_of_interaction?.transaction_data;
    return json({
      ok: true,
      intent_id: intentId,
      payment_id: mpData.id,
      amount: mpData.transaction_amount,
      qr_code_base64: tx?.qr_code_base64 || "",
      qr_code: tx?.qr_code || "",
      ticket_url: tx?.ticket_url || "",
    });
  } catch (e) {
    console.error("mercadopago-create-pix exception:", (e as Error).message);
    return json({ error: "Falha interna ao gerar Pix" }, 500);
  }
});
