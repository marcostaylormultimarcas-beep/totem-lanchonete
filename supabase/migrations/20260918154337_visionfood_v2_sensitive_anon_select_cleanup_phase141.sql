drop policy if exists "visionfood deny legacy clientes"
on public.clientes;

revoke select on table
  public.assinaturas_loja,
  public.caixa_movimentos,
  public.caixas_pdv,
  public.cancelamentos_pedido,
  public.clientes,
  public.config_impressao,
  public.configuracoes,
  public.customers,
  public.itens_pedido,
  public.papeis_usuario,
  public.pedidos,
  public.perfis,
  public.store_subscriptions,
  public.user_roles,
  public.v_financeiro_detalhado,
  public.vw_operadores
from anon;
