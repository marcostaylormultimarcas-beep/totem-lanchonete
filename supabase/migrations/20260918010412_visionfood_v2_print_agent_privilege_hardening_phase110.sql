
revoke execute on function public.print_agent_claim_jobs(text,integer)
  from public,anon,authenticated;
grant execute on function public.print_agent_claim_jobs(text,integer)
  to service_role;

revoke execute on function public.print_agent_ack(text,uuid,boolean,text)
  from public,anon,authenticated;
grant execute on function public.print_agent_ack(text,uuid,boolean,text)
  to service_role;

create index if not exists idx_logs_impressao_order_id
  on public.logs_impressao(order_id);
