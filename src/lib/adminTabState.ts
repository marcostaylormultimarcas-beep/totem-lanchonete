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

export type AdminTier = 'super' | 'master' | 'admin';

const MASTER_ONLY_TABS = new Set<AdminTab>(['admins', 'multilojas']);
const SUPER_ONLY_TABS = new Set<AdminTab>([
  'plans',
  'onesignal',
  'billing',
  'parcerias_map',
  'super',
]);

export const isAdminTabAllowedForTier = (tab: AdminTab, tier: AdminTier): boolean => {
  if (tier === 'super') return true;
  if (SUPER_ONLY_TABS.has(tab)) return false;
  if (tier === 'master') return true;
  return !MASTER_ONLY_TABS.has(tab);
};

export const normalizeAdminTabForTier = (tab: AdminTab, tier: AdminTier): AdminTab =>
  isAdminTabAllowedForTier(tab, tier) ? tab : 'orders';

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
