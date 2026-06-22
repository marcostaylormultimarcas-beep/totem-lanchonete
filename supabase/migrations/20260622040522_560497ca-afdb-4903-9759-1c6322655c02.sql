-- 1. Adiciona coluna 'notes' faltante em orders (PDV salva observações/cupom aqui)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS notes text;

-- 2. Reforça permissões nas funções de checagem de role (algumas RLS dependem delas
--    e estavam disparando "permission denied for function is_master_admin")
GRANT EXECUTE ON FUNCTION public.is_master_admin(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_owns_org(uuid, uuid) TO anon, authenticated, service_role;