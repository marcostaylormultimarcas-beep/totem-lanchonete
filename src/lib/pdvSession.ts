import { supabase } from "@/integrations/supabase/client";

export type PdvOperator = {
  id: string;
  name: string;
  username: string;
  organization_id: string;
  org_slug: string;
  org_name: string;
};

export type PdvSession = {
  operador: PdvOperator;
  sessionToken: string;
  caixaId: string | null;
};

export const PDV_SESSION_KEY = "pdv_session_v2";

const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase.rpc as any)(name, args);

export async function createPdvSession(orgSlug: string, username: string, password: string) {
  const { data, error } = await rpc("pdv_create_session", {
    _org_slug: orgSlug.trim().toLowerCase(),
    _username: username.trim().toLowerCase(),
    _password: password,
  });
  if (error) throw error;
  return data as any;
}

export async function validatePdvSession(sessionToken: string) {
  const { data, error } = await rpc("pdv_session_context", { _token: sessionToken });
  if (error) return null;
  const res = data as any;
  return res?.ok ? res : null;
}

export async function revokePdvSession(sessionToken: string) {
  try { await rpc("pdv_revoke_session", { _token: sessionToken }); } catch {}
}

export function savePdvSession(session: PdvSession) {
  sessionStorage.setItem(PDV_SESSION_KEY, JSON.stringify(session));
  localStorage.removeItem("pdv_session_v1");
}

export function readPdvSession(): PdvSession | null {
  try {
    const raw = sessionStorage.getItem(PDV_SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value?.operador || !value?.sessionToken) return null;
    return value as PdvSession;
  } catch {
    return null;
  }
}

export function clearPdvSession() {
  sessionStorage.removeItem(PDV_SESSION_KEY);
  localStorage.removeItem("pdv_session_v1");
}

export const pdvRpc = {
  openCash: (sessionToken: string, saldoInicial: number) => rpc("pdv_abrir_caixa_v2", { _session_token: sessionToken, _saldo_inicial: saldoInicial }),
  catalog: (sessionToken: string) => rpc("pdv_catalog_v2", { _session_token: sessionToken }),
  validateCoupon: (sessionToken: string, codigo: string) => rpc("pdv_validar_cupom_v2", { _session_token: sessionToken, _codigo: codigo }),
  movement: (sessionToken: string, caixaId: string, tipo: string, forma: string, valor: number, motivo: string) => rpc("pdv_registrar_movimento_v2", { _session_token: sessionToken, _caixa_id: caixaId, _tipo: tipo, _forma: forma, _valor: valor, _motivo: motivo }),
  sale: (sessionToken: string, caixaId: string, items: unknown[], forma: string, total: number, cupomCode: string, desconto: number) => rpc("pdv_registrar_venda_v2", { _session_token: sessionToken, _caixa_id: caixaId, _items: items, _forma: forma, _total: total, _cupom_code: cupomCode, _desconto: desconto }),
  findOrder: (sessionToken: string, query: string) => rpc("pdv_buscar_pedido_v2", { _session_token: sessionToken, _query: query }),
  refund: (sessionToken: string, caixaId: string, orderId: string, items: unknown[], valor: number, motivo: string) => rpc("pdv_devolver_pedido_v2", { _session_token: sessionToken, _caixa_id: caixaId, _order_id: orderId, _items_devolvidos: items, _valor_devolucao: valor, _motivo: motivo }),
  setOrderCustomerPhone: (sessionToken: string, orderId: string, customerPhone: string) => rpc("pdv_set_order_customer_phone_v2", { _session_token: sessionToken, _order_id: orderId, _customer_phone: customerPhone }),
  cashSummary: (sessionToken: string, caixaId: string) => rpc("pdv_caixa_resumo_v2", { _session_token: sessionToken, _caixa_id: caixaId }),
  closeCash: (sessionToken: string, caixaId: string) => rpc("pdv_fechar_caixa_v2", { _session_token: sessionToken, _caixa_id: caixaId }),
};
