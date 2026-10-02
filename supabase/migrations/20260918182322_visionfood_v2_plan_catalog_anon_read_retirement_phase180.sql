drop policy if exists "visionfood public read plans" on public.plans;
drop policy if exists "visionfood public read features" on public.features;
drop policy if exists "visionfood public read plan_features" on public.plan_features;

create policy "visionfood authenticated read plans"
on public.plans
for select
to authenticated
using (true);

create policy "visionfood authenticated read features"
on public.features
for select
to authenticated
using (true);

create policy "visionfood authenticated read plan_features"
on public.plan_features
for select
to authenticated
using (true);

revoke select on table
  public.plans,
  public.features,
  public.plan_features
from anon;

grant select on table
  public.plans,
  public.features,
  public.plan_features
to authenticated;
