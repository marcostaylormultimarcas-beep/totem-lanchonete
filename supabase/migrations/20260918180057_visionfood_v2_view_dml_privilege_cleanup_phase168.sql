revoke insert, update, delete
on table
  public.v_financeiro_detalhado,
  public.vw_operadores
from authenticated;

revoke insert, update, delete
on table
  public.v_financeiro_detalhado,
  public.vw_operadores
from anon;
