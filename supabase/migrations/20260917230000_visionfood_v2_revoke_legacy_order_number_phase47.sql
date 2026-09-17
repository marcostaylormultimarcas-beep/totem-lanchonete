-- Phase 47: clients no longer allocate order numbers outside atomic checkout.
revoke execute on function public.next_order_number(uuid) from public, anon, authenticated;
comment on function public.next_order_number(uuid) is 'Legacy helper disabled for client roles after atomic create_order_checkout cutover.';
