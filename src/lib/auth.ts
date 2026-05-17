import { supabase } from '@/integrations/supabase/client';

/**
 * Logout completo: encerra sessão Supabase, limpa cache local
 * (preservando versão da app) e redireciona para /auth.
 */
export async function signOutCompletely(redirectTo: string = '/auth') {
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
 * Checa se usuário atual tem role master.
 */
export async function isCurrentUserMaster(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('user_roles' as any)
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'master')
    .maybeSingle();
  return !!data;
}

/**
 * Busca a organização do usuário logado (ou null).
 */
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
