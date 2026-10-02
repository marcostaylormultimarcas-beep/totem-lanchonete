-- Phase 51: unify PDV order numbering with the atomic organization counter.
-- next_order_number remains internal-only (Phase 47) and is called inside the sale transaction.

create or replace function public.next_order_number(_organization_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare _n bigint; _candidate text;
begin
 if _organization_id is null then raise exception 'organization_id is required'; end if;
 loop
  insert into public.order_number_counters(organization_id,last_number) values(_organization_id,1)
  on conflict (organization_id) do update set last_number=public.order_number_counters.last_number+1,updated_at=now()
  returning last_number into _n;
  _candidate:=lpad(_n::text,3,'0');
  exit when not exists(select 1 from public.orders where organization_id=_organization_id and order_number=_candidate);
 end loop;
 return _candidate;
end $$;
revoke execute on function public.next_order_number(uuid) from public,anon,authenticated;

-- Applied to the installed pdv_registrar_venda_v2 and pdv_registrar_venda_pix_v2 definitions:
-- replace timestamp-derived order number allocation with:
--   onum := public.next_order_number(s.organization_id);
