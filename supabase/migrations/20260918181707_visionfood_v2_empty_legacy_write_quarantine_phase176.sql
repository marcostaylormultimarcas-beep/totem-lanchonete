revoke insert,update,delete
on table
  public.bairros_atendidos,
  public.categorias,
  public.ceps_atendidos,
  public.temas_loja
from authenticated;
