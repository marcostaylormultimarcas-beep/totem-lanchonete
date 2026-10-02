drop policy if exists "visionfood public read bairros" on public.bairros;
drop policy if exists "public read bairros_atendidos" on public.bairros_atendidos;
drop policy if exists "public read categorias" on public.categorias;
drop policy if exists "public read ceps_atendidos" on public.ceps_atendidos;
drop policy if exists "visionfood public read configuracoes_loja" on public.configuracoes_loja;
drop policy if exists "visionfood public read lojas" on public.lojas;
drop policy if exists "public read temas_loja" on public.temas_loja;

revoke select on table
  public.bairros,
  public.bairros_atendidos,
  public.categorias,
  public.ceps_atendidos,
  public.configuracoes_loja,
  public.lojas,
  public.temas_loja
from anon, authenticated;
