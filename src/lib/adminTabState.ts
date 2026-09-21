export const ADMIN_TAB_KEYS = [
  'orders',
  'dashboard',
  'multilojas',
  'products',
  'banners',
  'coupons',
  'loyalty',
  'crm',
  'leads',
  'entregadores',
  'bairros',
  'area_cep',
  'delivery',
  'logistica',
  'rotaIA',
  'prime',
  'parcerias',
  'operacao',
  'assistente',
  'tema',
  'impressao',
  'financeiro',
  'estoque',
  'preditivo',
  'assinatura',
  'settings',
  'fiscal',
  'admins',
  'super',
  'plans',
  'parcerias_map',
  'onesignal',
  'billing',
  'senhas',
  'pdv_operadores',
  'mesas',
] as const;

export type AdminTab = (typeof ADMIN_TAB_KEYS)[number];

const ADMIN_TAB_SET = new Set<string>(ADMIN_TAB_KEYS);

export const parseAdminTab = (value: string | null | undefined): AdminTab =>
  value && ADMIN_TAB_SET.has(value) ? (value as AdminTab) : 'orders';

export const withAdminTabSearchParams = (
  current: URLSearchParams,
  tab: AdminTab,
): URLSearchParams => {
  const next = new URLSearchParams(current);
  next.set('tab', tab);
  return next;
};
