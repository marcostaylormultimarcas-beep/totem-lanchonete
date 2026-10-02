
create index if not exists loyalty_points_ledger_reward_id_idx
  on public.loyalty_points_ledger(reward_id)
  where reward_id is not null;

create index if not exists loyalty_rewards_product_id_idx
  on public.loyalty_rewards(product_id)
  where product_id is not null;

create index if not exists resgates_fidelidade_reward_id_idx
  on public.resgates_fidelidade(reward_id)
  where reward_id is not null;
