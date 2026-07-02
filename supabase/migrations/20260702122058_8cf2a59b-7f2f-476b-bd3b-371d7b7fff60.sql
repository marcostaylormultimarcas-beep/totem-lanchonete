-- Reset SELETIVO: limpa histórico de pedidos, produtos e tabelas relacionadas de dados operacionais.
-- Preserva: auth.users, user_roles, organizations, entregadores, config MP, profiles.

TRUNCATE TABLE
  public.order_cancellations,
  public.pedidos_carimbados,
  public.entregas_log,
  public.logs_impressao,
  public.senhas_chamadas,
  public.caixa_movimentos,
  public.caixas_pdv,
  public.progresso_fidelidade,
  public.resgates_fidelidade,
  public.cliente_notificacoes,
  public.product_reviews,
  public.ai_suggestions_history,
  public.alertas_estoque,
  public.assistente_vision_feedback,
  public.orders,
  public.ingredientes,
  public.receitas,
  public.products
RESTART IDENTITY CASCADE;
