import fs from 'node:fs';

const pdv = fs.readFileSync('src/pages/PDV.tsx', 'utf8');
const helper = fs.readFileSync('src/lib/pdvSession.ts', 'utf8');
const createPix = fs.readFileSync('supabase/functions/mercadopago-create-pix/index.ts', 'utf8');
const webhook = fs.readFileSync('supabase/functions/mercadopago-pdv-webhook/index.ts', 'utf8');
const phase24 = fs.readFileSync('supabase/migrations/20260916042000_visionfood_v2_pix_idempotent_sale_phase24.sql', 'utf8');

const checks = [
  ['frontend creates server PIX intent', pdv.includes('pdvRpc.createPixIntent(')],
  ['frontend does not send authoritative amount to edge', pdv.includes('body: { intent_id: intent.intent_id, session_token: sessionToken }')],
  ['frontend polls server PIX status', pdv.includes('pdvRpc.pixStatus(sessionToken, pixData.intentId)') && pdv.includes('setTimeout(check, 2500)')],
  ['frontend finalizes PIX through idempotent RPC', pdv.includes('pdvRpc.pixSale(sessionToken, pixData.intentId)')],
  ['helper maps PIX sale RPC', helper.includes('pdv_registrar_venda_pix_v2')],
  ['edge claims intent server-side', createPix.includes('pdv_claim_pix_intent_internal')],
  ['edge binds Mercado Pago payment', createPix.includes('pdv_bind_pix_payment_internal')],
  ['webhook updates status server-side', webhook.includes('pdv_update_pix_payment_internal')],
  ['webhook requires signature secret', webhook.includes('MP_PDV_WEBHOOK_SECRET')],
  ['webhook verifies external reference', webhook.includes('external_reference') && webhook.includes('pdv_pix_intent:')],
  ['idempotent sale requires paid_at', phase24.includes('i.paid_at is null')],
  ['idempotent sale reuses existing order', phase24.includes("'idempotent',true") && phase24.includes('i.order_id is not null')],
  ['sale movement links order via metadata', phase24.includes("'order_id',oid") && phase24.includes('pedido_id,metadata')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`PIX contract verification failed: ${failed} check(s)`);
  process.exit(1);
}
console.log(`PIX contract verification passed: ${checks.length} checks`);
