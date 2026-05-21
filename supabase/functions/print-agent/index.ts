// VisionFood — Print Agent endpoint (ESC/POS)
// Called by the local desktop agent installed at the store's PC.
// Auth is via printer agent token (not a Supabase JWT).

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-agent-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ---------- ESC/POS builder ----------
const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

class EscPos {
  private buf: number[] = [];
  raw(...b: number[]) { this.buf.push(...b); return this; }
  text(s: string) {
    // Encode as CP850 fallback to ASCII; printers typically accept CP850/PC860 for PT-BR.
    // Simple approach: strip diacritics for safety.
    const norm = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const ch of norm) this.buf.push(ch.charCodeAt(0) & 0xff);
    return this;
  }
  ln(s = '') { return this.text(s).raw(LF); }
  init() { return this.raw(ESC, 0x40); }
  align(a: 'L'|'C'|'R') { return this.raw(ESC, 0x61, a === 'L' ? 0 : a === 'C' ? 1 : 2); }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  size(n: 0|1|2|3) {
    // n: 0 normal, 1 double height, 2 double width, 3 both
    const v = (n & 0x01 ? 0x01 : 0) | (n & 0x02 ? 0x10 : 0);
    return this.raw(GS, 0x21, v);
  }
  feed(n: number) { return this.raw(ESC, 0x64, Math.max(0, Math.min(n, 8))); }
  cut() { return this.raw(GS, 0x56, 0x00); }
  qrcode(data: string, moduleSize = 6) {
    const bytes = new TextEncoder().encode(data);
    // Model 2
    this.raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    // Module size
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize);
    // Error correction L
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30);
    // Store data
    const len = bytes.length + 3;
    this.raw(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30);
    for (const b of bytes) this.buf.push(b);
    // Print
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    return this;
  }
  toBytes() { return new Uint8Array(this.buf); }
}

function brl(n: number) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildReceipt(opts: {
  storeName: string;
  order: any;
  paperWidth: number;
  trackUrl: string;
}) {
  const { storeName, order, paperWidth, trackUrl } = opts;
  const W = paperWidth || 48;
  const ep = new EscPos();
  const line = (l: string, r: string) => {
    const space = Math.max(1, W - l.length - r.length);
    return l + ' '.repeat(space) + r;
  };
  const divider = '-'.repeat(W);

  ep.init().align('C').bold(true).size(1).ln(storeName).size(0).bold(false);
  const dt = new Date(order.created_at || Date.now());
  ep.ln(`${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  ep.bold(true).ln(`PEDIDO #${order.order_number}`).bold(false);
  ep.align('L').ln(divider);

  ep.ln(`Cliente: ${order.customer_name || ''}`);
  if (order.customer_phone) ep.ln(`Telefone: ${order.customer_phone}`);
  const typeLabel = order.order_type === 'delivery' || order.order_type === 'viagem'
    ? 'DELIVERY' : order.order_type === 'retirada' ? 'RETIRADA' : 'COMER NO LOCAL';
  ep.ln(`Tipo: ${typeLabel}`);
  if ((order.order_type === 'delivery' || order.order_type === 'viagem') && order.delivery_address) {
    ep.ln(`Endereco: ${order.delivery_address}`);
    if (order.delivery_reference) ep.ln(`Ref: ${order.delivery_reference}`);
    if (order.delivery_recipient) ep.ln(`Recebe: ${order.delivery_recipient}`);
    if (order.delivery_code) ep.bold(true).ln(`CODIGO ENTREGA: ${order.delivery_code}`).bold(false);
  }
  ep.ln(divider).bold(true).ln('ITENS').bold(false);

  const items = Array.isArray(order.items) ? order.items : [];
  let subtotal = 0;
  for (const it of items) {
    const qty = Number(it.quantity || 1);
    const tot = Number(it.total || 0);
    subtotal += tot;
    ep.ln(line(`${qty}x ${String(it.name || '').slice(0, W - 12)}`, brl(tot)));
    const unit = qty > 0 ? tot / qty : tot;
    ep.ln(`   un: ${brl(unit)}`);
    const removed: string[] = it.removedIngredients || [];
    const extras = (it.extras || it.selectedExtras || []).map((e: any) => typeof e === 'string' ? e : e.name);
    if (removed.length) ep.ln(`   Sem: ${removed.join(', ')}`);
    if (extras.length) ep.ln(`   Add: ${extras.join(', ')}`);
    if (it.notes || it.observation) ep.ln(`   Obs: ${it.notes || it.observation}`);
  }

  const total = Number(order.total || 0);
  const discount = Math.max(0, subtotal - total + Number(order.delivery_fee || 0));
  ep.ln(divider);
  ep.ln(line('Subtotal', brl(subtotal)));
  if (order.delivery_fee && Number(order.delivery_fee) > 0) ep.ln(line('Taxa entrega', brl(order.delivery_fee)));
  if (discount > 0) ep.ln(line('Desconto', '- ' + brl(discount)));
  ep.bold(true).size(1).ln(line('TOTAL', brl(total))).size(0).bold(false);
  if (order.payment_method) ep.ln(`Pagto: ${order.payment_method}`);

  ep.ln(divider).align('C').feed(1);
  ep.qrcode(trackUrl, 6);
  ep.feed(1).ln('Acompanhe seu pedido').ln(`#${order.order_number}`);
  ep.feed(3).cut();

  return ep.toBytes();
}

function b64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// ---------- HTTP ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = new URL(req.url);
  const action = url.pathname.split('/').filter(Boolean).pop() || '';
  const token = req.headers.get('x-agent-token') || '';
  if (!token) return json({ ok: false, reason: 'missing_token' }, 401);

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    if (action === 'auth') {
      const { data, error } = await supa.rpc('print_agent_authenticate', { _token: token });
      if (error) return json({ ok: false, reason: error.message }, 400);
      return json(data);
    }

    if (action === 'jobs') {
      const { data: claim, error } = await supa.rpc('print_agent_claim_jobs', { _token: token, _limit: 10 });
      if (error) return json({ ok: false, reason: error.message }, 400);
      if (!claim?.ok) return json(claim, 401);

      const orgId = claim.organization_id;
      const { data: setRow } = await supa
        .from('settings').select('store_name').eq('organization_id', orgId).maybeSingle();
      const { data: cfgRow } = await supa
        .from('configuracoes_impressao').select('paper_width').eq('organization_id', orgId).maybeSingle();
      const { data: orgRow } = await supa
        .from('organizations').select('slug').eq('id', orgId).maybeSingle();

      const storeName = (setRow?.store_name || 'Pedido').toString();
      const paperWidth = Number(cfgRow?.paper_width || 48);
      const slug = orgRow?.slug || '';
      const origin = req.headers.get('origin') || 'https://app';

      const jobs = (claim.jobs || []).map((order: any) => {
        const trackUrl = `${origin}/acompanhar/${order.order_number}`;
        const bytes = buildReceipt({ storeName, order, paperWidth, trackUrl });
        return {
          order_id: order.id,
          order_number: order.order_number,
          total: order.total,
          escpos_base64: b64(bytes),
        };
      });

      return json({ ok: true, jobs });
    }

    if (action === 'ack') {
      const body = await req.json().catch(() => ({}));
      const order_id = body?.order_id;
      const success = Boolean(body?.success);
      const errorMsg = String(body?.error || '');
      if (!order_id) return json({ ok: false, reason: 'order_id_required' }, 400);
      const { data, error } = await supa.rpc('print_agent_ack', {
        _token: token, _order_id: order_id, _success: success, _error: errorMsg,
      });
      if (error) return json({ ok: false, reason: error.message }, 400);
      return json(data);
    }

    return json({ ok: false, reason: 'unknown_action' }, 404);
  } catch (e) {
    return json({ ok: false, reason: String(e?.message || e) }, 500);
  }
});
