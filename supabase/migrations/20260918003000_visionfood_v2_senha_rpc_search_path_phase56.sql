-- Phase 56: harden privileged senha RPC search paths.
-- chamar_proxima_senha may be absent in historical replays affected by the
-- missing Phase 41 migration file; Phase 198 recreates its authoritative
-- contract later in the chain.
do $$
begin
  if to_regprocedure('public.chamar_proxima_senha(uuid,text,text)') is not null then
    execute 'alter function public.chamar_proxima_senha(uuid,text,text) set search_path='''''';
  end if;
end
$$;

alter function public.reset_senha_counter(uuid,text) set search_path='';
