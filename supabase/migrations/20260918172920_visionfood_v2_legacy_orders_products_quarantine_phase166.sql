do $$
declare
  r record;
begin
  for r in
    select schemaname,tablename,policyname
    from pg_policies
    where schemaname='public'
      and tablename in ('pedidos','produtos','itens_pedido')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      r.policyname,r.schemaname,r.tablename
    );
  end loop;
end
$$;

revoke select,insert,update,delete
on table
  public.pedidos,
  public.produtos,
  public.itens_pedido
from anon,authenticated;
