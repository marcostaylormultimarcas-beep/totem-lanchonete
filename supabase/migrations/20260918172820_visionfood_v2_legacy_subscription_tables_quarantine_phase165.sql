drop policy if exists "visionfood owner manage assinatura"
on public.assinaturas_loja;

revoke select,insert,update,delete
on table public.assinaturas_loja
from authenticated;

revoke select,insert,update,delete
on table public.store_subscriptions
from authenticated;
