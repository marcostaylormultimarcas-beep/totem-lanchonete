drop policy if exists "visionfood public read planos" on public.planos;
drop policy if exists "visionfood public read plano_recursos" on public.plano_recursos;
drop policy if exists "public read recursos" on public.recursos;
drop policy if exists "super manage recursos" on public.recursos;

revoke select,insert,update,delete
on table
  public.planos,
  public.plano_recursos,
  public.recursos
from anon,authenticated;
