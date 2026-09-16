import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

async function verifyMercadoPagoSignature(req: Request, dataId: string, secret: string) {
  const xSignature = req.headers.get("x-signature") || "";
  const xRequestId = req.headers.get("x-request-id") || "";
  if (!xSignature || !xRequestId || !dataId || !secret) return false;

  let ts = "";
  let v1 = "";
  for (const part of xSignature.split(",")) {
    const [rawKey, ...rawValue] = part.split("=");
    const key = rawKey?.trim();
    const value = rawValue.join("=").trim();
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value.toLowerCase();
  }
  if (!ts || !v1) return false;

  // Mercado Pago's documented manifest for payment webhooks.
  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(manifest));
  return safeEqual(hex(digest), v1);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const MP_WEBHOOK_SECRET = Deno.env.get("MP_PDV_WEBHOOK_SECRET")!;
  if (!SUPABASE_URL || !SERVICE_ROLE || !MP_WEBHOOK_SECRET) return json({ ok: false }, 500);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const type = String(body?.type || body?.topic || url.searchParams.get("type") || url.searchParams.get("topic") || "");
    const paymentId = String(body?.data?.id || body?.id || url.searchParams.get("data.id") || url.searchParams.get("id") || "");
    if (!type.includes("payment") || !paymentId) return json({ ok: true });

    if (!(await verifyMercadoPagoSignature(req, paymentId, MP_WEBHOOK_SECRET))) {
      return json({ ok: false }, 401);
    }

    // Find the local intent first. This prevents this endpoint from processing SaaS subscription payments.
    const { data: intent, error: intentErr } = await admin
      .from("pdv_pix_intents")
      .select("id,organization_id,amount,mp_payment_id")
      .eq("mp_payment_id", paymentId)
      .maybeSingle();
    if (intentErr || !intent) return json({ ok: true });

    const { data: tokenData, error: tokenErr } = await admin.rpc("get_mp_access_token_internal", { _org: intent.organization_id });
    const accessToken = (tokenData as string | null) || "";
    if (tokenErr || !accessToken) return json({ ok: false }, 500);

    // Never trust webhook status/body. Fetch the payment from Mercado Pago using the merchant credential.
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!mpRes.ok) return json({ ok: false }, 502);
    const pay = await mpRes.json();
    if (String(pay.id) !== paymentId) return json({ ok: false }, 400);
    if (String(pay.external_reference || "") !== `pdv_pix_intent:${intent.id}`) return json({ ok: false }, 400);
    if (Math.abs(Number(pay.transaction_amount) - Number(intent.amount)) > 0.005) return json({ ok: false }, 400);

    const status = String(pay.status || "pending").toLowerCase();
    const detail = String(pay.status_detail || "");
    const { data: updated, error: updateErr } = await admin.rpc("pdv_update_pix_payment_internal", {
      _payment_id: paymentId,
      _status: status,
      _status_detail: detail,
      _amount: Number(pay.transaction_amount),
    });
    if (updateErr || !(updated as any)?.ok) return json({ ok: false }, 500);
    return json({ ok: true });
  } catch (e) {
    console.error("mercadopago-pdv-webhook", (e as Error).message);
    return json({ ok: false }, 500);
  }
});
