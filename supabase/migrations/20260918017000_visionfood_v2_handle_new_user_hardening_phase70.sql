-- Phase 70: harden the auth.users profile trigger function.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.profiles(user_id,display_name)
  values(new.id,coalesce(new.raw_user_meta_data->>'display_name',''))
  on conflict(user_id) do nothing;
  return new;
end
$$;
