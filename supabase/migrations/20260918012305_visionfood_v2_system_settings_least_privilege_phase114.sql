
revoke insert,update,delete,truncate,references,trigger
  on table public.system_settings
  from anon,authenticated;
