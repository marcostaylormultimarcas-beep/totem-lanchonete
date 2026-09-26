-- Phase 82: partnership reward terms belong to the origin organization that funds/issues the reward.
create or replace function public.parceria_set_rules(_parceria_id uuid,_min_order numeric,_discount numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r public.parcerias%rowtype;
begin
 if u is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
 select * into r from public.parcerias where id=_parceria_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
 if not public.usuario_dono_org(r.org_origem,u) and not public.eh_super_admin(u) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if r.status<>'active' then return jsonb_build_object('ok',false,'reason','invalid_status'); end if;
 if _min_order is null or _min_order<0 or _min_order>1000000 then return jsonb_build_object('ok',false,'reason','invalid_min_order'); end if;
 if _discount is null or _discount<=0 or _discount>100 then return jsonb_build_object('ok',false,'reason','invalid_discount'); end if;
 update public.parcerias set min_order_value=round(_min_order,2),discount_percent=round(_discount,2),updated_at=now() where id=_parceria_id;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function public.parceria_set_rules(uuid,numeric,numeric) from public,anon;
grant execute on function public.parceria_set_rules(uuid,numeric,numeric) to authenticated;
