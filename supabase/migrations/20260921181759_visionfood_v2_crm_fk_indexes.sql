
create index if not exists crm_interactions_converted_order_id_idx
  on public.crm_interactions (converted_order_id)
  where converted_order_id is not null;

create index if not exists crm_interactions_campaign_id_idx
  on public.crm_interactions (campaign_id)
  where campaign_id is not null;

create index if not exists crm_tasks_automation_id_idx
  on public.crm_tasks (automation_id)
  where automation_id is not null;
