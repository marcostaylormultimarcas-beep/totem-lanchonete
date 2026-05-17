import { supabase } from '@/integrations/supabase/client';

export type RoleTier = 'super' | 'master' | 'admin' | null;

export async function signOutCompletely(redirectTo: string = '/') {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.error('signOut error', e);
  }
  const version = localStorage.getItem('app_version');
  localStorage.clear();
  sessionStorage.clear();
  if (version) localStorage.setItem('app_version', version);
  window.location.replace(redirectTo);
}

/**
 * Retorna o tier do usuário atual seguindo a hierarquia:
 * 'super'  → super_admin (ou legado 'master')
 * 'master' → master_admin
 * 'admin'  → admin (lojista)
 */
export async function getCurrentUserRoleTier(): Promise<RoleTier> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('user_roles' as any)
    .select('role')
    .eq('user_id', user.id);
  const roles = (data || []).map((r: any) => r.role);
  if (roles.includes('super_admin') || roles.includes('master')) return 'super';
  if (roles.includes('master_admin')) return 'master';
  if (roles.includes('admin')) return 'admin';
  return null;
}

export async function isCurrentUserMaster(): Promise<boolean> {
  const tier = await getCurrentUserRoleTier();
  return tier === 'super';
}

export async function getCurrentUserOrg() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('organizations')
    .select('*')
    .eq('owner_id', user.id)
    .maybeSingle();
  return data;
}
