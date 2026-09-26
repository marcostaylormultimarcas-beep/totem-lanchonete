-- PHASE 241 — rls_enabled_no_policy / public.pedidos
-- public.pedidos is a quarantined legacy table (RLS enabled, no policies, no anon/authenticated grants).
-- The active PDV refund flow writes public.orders.id into public.caixa_movimentos.pedido_id.
-- Repair the stale legacy FK so the dependent refund path references the canonical orders table.

alter table public.caixa_movimentos
  drop constraint if exists caixa_movimentos_pedido_id_fkey;

alter table public.caixa_movimentos
  add constraint caixa_movimentos_pedido_id_fkey
  foreign key (pedido_id)
  references public.orders(id)
  on delete set null;
