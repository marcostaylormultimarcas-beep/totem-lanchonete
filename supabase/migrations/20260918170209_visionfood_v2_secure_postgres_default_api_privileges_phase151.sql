alter default privileges in schema public
  revoke all on tables from anon,authenticated,service_role;
alter default privileges in schema public
  revoke all on sequences from anon,authenticated,service_role;
alter default privileges in schema public
  revoke execute on functions from public,anon,authenticated,service_role;
