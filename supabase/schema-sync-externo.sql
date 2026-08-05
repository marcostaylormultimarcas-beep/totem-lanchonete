-- Sincroniza o banco externo com o schema esperado pelo app (idempotente)
-- Rode este script no SQL Editor do seu Supabase.

CREATE TABLE IF NOT EXISTS public.admins (
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  is_master boolean,
  organization_id uuid,
  password text,
  paused boolean,
  updated_at timestamptz default now(),
  username text
);
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS is_master boolean;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS password text;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS paused boolean;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS username text;
GRANT SELECT ON public.admins TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admins TO authenticated;
GRANT ALL ON public.admins TO service_role;

CREATE TABLE IF NOT EXISTS public.ai_suggestions_history (
  acted_at timestamptz,
  audience_size numeric,
  category text,
  conversions numeric,
  created_at timestamptz default now(),
  dismiss_reason text,
  dispatched_at timestamptz,
  generated_at timestamptz,
  id uuid primary key default gen_random_uuid(),
  last_conversion_check text,
  notifications_sent numeric,
  organization_id uuid,
  priority numeric,
  reason text,
  status text,
  suggestion_key text,
  template text,
  title text,
  updated_at timestamptz default now()
);
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS acted_at timestamptz;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS audience_size numeric;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS conversions numeric;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS dismiss_reason text;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS generated_at timestamptz;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS last_conversion_check text;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS notifications_sent numeric;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS priority numeric;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS suggestion_key text;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS template text;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.ai_suggestions_history ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.ai_suggestions_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_suggestions_history TO authenticated;
GRANT ALL ON public.ai_suggestions_history TO service_role;

CREATE TABLE IF NOT EXISTS public.alertas_estoque (
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  ingrediente_id uuid,
  mensagem text,
  organization_id uuid,
  product_id uuid,
  resolvido boolean,
  tipo text,
  webhook_error text,
  webhook_status text
);
ALTER TABLE public.alertas_estoque ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.alertas_estoque ADD COLUMN IF NOT EXISTS ingrediente_id uuid;
ALTER TABLE public.alertas_estoque ADD COLUMN IF NOT EXISTS mensagem text;
ALTER TABLE public.alertas_estoque ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.alertas_estoque ADD COLUMN IF NOT EXISTS product_id uuid;
ALTER TABLE public.alertas_estoque ADD COLUMN IF NOT EXISTS resolvido boolean;
ALTER TABLE public.alertas_estoque ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE public.alertas_estoque ADD COLUMN IF NOT EXISTS webhook_error text;
ALTER TABLE public.alertas_estoque ADD COLUMN IF NOT EXISTS webhook_status text;
GRANT SELECT ON public.alertas_estoque TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alertas_estoque TO authenticated;
GRANT ALL ON public.alertas_estoque TO service_role;

CREATE TABLE IF NOT EXISTS public.assistente_vision_feedback (
  action text,
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  message_sent text,
  organization_id uuid,
  reason text,
  suggestion_key text
);
ALTER TABLE public.assistente_vision_feedback ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.assistente_vision_feedback ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.assistente_vision_feedback ADD COLUMN IF NOT EXISTS message_sent text;
ALTER TABLE public.assistente_vision_feedback ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.assistente_vision_feedback ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.assistente_vision_feedback ADD COLUMN IF NOT EXISTS suggestion_key text;
GRANT SELECT ON public.assistente_vision_feedback TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistente_vision_feedback TO authenticated;
GRANT ALL ON public.assistente_vision_feedback TO service_role;

CREATE TABLE IF NOT EXISTS public.caixa_movimentos (
  caixa_id uuid,
  created_at timestamptz default now(),
  forma_pagamento text,
  id uuid primary key default gen_random_uuid(),
  metadata jsonb,
  motivo text,
  operador_id uuid,
  operador_nome text,
  order_id uuid,
  organization_id uuid,
  tipo text,
  valor numeric
);
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS caixa_id uuid;
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS forma_pagamento text;
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS motivo text;
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS operador_id uuid;
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS operador_nome text;
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS valor numeric;
GRANT SELECT ON public.caixa_movimentos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.caixa_movimentos TO authenticated;
GRANT ALL ON public.caixa_movimentos TO service_role;

CREATE TABLE IF NOT EXISTS public.caixas_pdv (
  closed_at timestamptz,
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  opened_at timestamptz,
  operador_id uuid,
  operador_nome text,
  organization_id uuid,
  resumo jsonb,
  saldo_final numeric,
  saldo_inicial numeric,
  status text,
  updated_at timestamptz default now()
);
ALTER TABLE public.caixas_pdv ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.caixas_pdv ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.caixas_pdv ADD COLUMN IF NOT EXISTS opened_at timestamptz;
ALTER TABLE public.caixas_pdv ADD COLUMN IF NOT EXISTS operador_id uuid;
ALTER TABLE public.caixas_pdv ADD COLUMN IF NOT EXISTS operador_nome text;
ALTER TABLE public.caixas_pdv ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.caixas_pdv ADD COLUMN IF NOT EXISTS resumo jsonb;
ALTER TABLE public.caixas_pdv ADD COLUMN IF NOT EXISTS saldo_final numeric;
ALTER TABLE public.caixas_pdv ADD COLUMN IF NOT EXISTS saldo_inicial numeric;
ALTER TABLE public.caixas_pdv ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.caixas_pdv ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.caixas_pdv TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.caixas_pdv TO authenticated;
GRANT ALL ON public.caixas_pdv TO service_role;

CREATE TABLE IF NOT EXISTS public.cep_atendidos (
  cep text,
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  taxa numeric,
  tempo_min numeric,
  updated_at timestamptz default now()
);
ALTER TABLE public.cep_atendidos ADD COLUMN IF NOT EXISTS cep text;
ALTER TABLE public.cep_atendidos ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.cep_atendidos ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.cep_atendidos ADD COLUMN IF NOT EXISTS taxa numeric;
ALTER TABLE public.cep_atendidos ADD COLUMN IF NOT EXISTS tempo_min numeric;
ALTER TABLE public.cep_atendidos ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.cep_atendidos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cep_atendidos TO authenticated;
GRANT ALL ON public.cep_atendidos TO service_role;

CREATE TABLE IF NOT EXISTS public.cliente_notificacoes (
  body text,
  clicked_at timestamptz,
  coupon_code text,
  created_at timestamptz default now(),
  cta_route text,
  customer_phone text,
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  read_at timestamptz,
  suggestion_key text,
  title text
);
ALTER TABLE public.cliente_notificacoes ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE public.cliente_notificacoes ADD COLUMN IF NOT EXISTS clicked_at timestamptz;
ALTER TABLE public.cliente_notificacoes ADD COLUMN IF NOT EXISTS coupon_code text;
ALTER TABLE public.cliente_notificacoes ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.cliente_notificacoes ADD COLUMN IF NOT EXISTS cta_route text;
ALTER TABLE public.cliente_notificacoes ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE public.cliente_notificacoes ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.cliente_notificacoes ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE public.cliente_notificacoes ADD COLUMN IF NOT EXISTS suggestion_key text;
ALTER TABLE public.cliente_notificacoes ADD COLUMN IF NOT EXISTS title text;
GRANT SELECT ON public.cliente_notificacoes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cliente_notificacoes TO authenticated;
GRANT ALL ON public.cliente_notificacoes TO service_role;

CREATE TABLE IF NOT EXISTS public.config_fidelidade (
  ativo boolean,
  created_at timestamptz default now(),
  descricao_premio text,
  id uuid primary key default gen_random_uuid(),
  meta_pedidos numeric,
  organization_id uuid,
  premio_imagem text,
  premio_recompensa text,
  updated_at timestamptz default now(),
  valor_minimo_pedido numeric
);
ALTER TABLE public.config_fidelidade ADD COLUMN IF NOT EXISTS ativo boolean;
ALTER TABLE public.config_fidelidade ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.config_fidelidade ADD COLUMN IF NOT EXISTS descricao_premio text;
ALTER TABLE public.config_fidelidade ADD COLUMN IF NOT EXISTS meta_pedidos numeric;
ALTER TABLE public.config_fidelidade ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.config_fidelidade ADD COLUMN IF NOT EXISTS premio_imagem text;
ALTER TABLE public.config_fidelidade ADD COLUMN IF NOT EXISTS premio_recompensa text;
ALTER TABLE public.config_fidelidade ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.config_fidelidade ADD COLUMN IF NOT EXISTS valor_minimo_pedido numeric;
GRANT SELECT ON public.config_fidelidade TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.config_fidelidade TO authenticated;
GRANT ALL ON public.config_fidelidade TO service_role;

CREATE TABLE IF NOT EXISTS public.configuracoes_impressao (
  agent_token text,
  auto_print boolean,
  created_at timestamptz default now(),
  enabled boolean,
  id uuid primary key default gen_random_uuid(),
  last_seen_at timestamptz,
  organization_id uuid,
  paper_width numeric,
  printer_ip text,
  printer_port numeric,
  updated_at timestamptz default now(),
  webhook_alerta_url text
);
ALTER TABLE public.configuracoes_impressao ADD COLUMN IF NOT EXISTS agent_token text;
ALTER TABLE public.configuracoes_impressao ADD COLUMN IF NOT EXISTS auto_print boolean;
ALTER TABLE public.configuracoes_impressao ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.configuracoes_impressao ADD COLUMN IF NOT EXISTS enabled boolean;
ALTER TABLE public.configuracoes_impressao ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE public.configuracoes_impressao ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.configuracoes_impressao ADD COLUMN IF NOT EXISTS paper_width numeric;
ALTER TABLE public.configuracoes_impressao ADD COLUMN IF NOT EXISTS printer_ip text;
ALTER TABLE public.configuracoes_impressao ADD COLUMN IF NOT EXISTS printer_port numeric;
ALTER TABLE public.configuracoes_impressao ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.configuracoes_impressao ADD COLUMN IF NOT EXISTS webhook_alerta_url text;
GRANT SELECT ON public.configuracoes_impressao TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuracoes_impressao TO authenticated;
GRANT ALL ON public.configuracoes_impressao TO service_role;

CREATE TABLE IF NOT EXISTS public.cupons (
  codigo text,
  created_at timestamptz default now(),
  data_fim text,
  data_inicio text,
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  status text,
  tipo text,
  updated_at timestamptz default now(),
  valor numeric
);
ALTER TABLE public.cupons ADD COLUMN IF NOT EXISTS codigo text;
ALTER TABLE public.cupons ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.cupons ADD COLUMN IF NOT EXISTS data_fim text;
ALTER TABLE public.cupons ADD COLUMN IF NOT EXISTS data_inicio text;
ALTER TABLE public.cupons ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.cupons ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.cupons ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE public.cupons ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.cupons ADD COLUMN IF NOT EXISTS valor numeric;
GRANT SELECT ON public.cupons TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cupons TO authenticated;
GRANT ALL ON public.cupons TO service_role;

CREATE TABLE IF NOT EXISTS public.entregadores (
  active boolean,
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  last_lat numeric,
  last_lng numeric,
  last_location_at timestamptz,
  last_location_order_id uuid,
  name text,
  organization_id uuid,
  password text,
  updated_at timestamptz default now(),
  username text
);
ALTER TABLE public.entregadores ADD COLUMN IF NOT EXISTS active boolean;
ALTER TABLE public.entregadores ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.entregadores ADD COLUMN IF NOT EXISTS last_lat numeric;
ALTER TABLE public.entregadores ADD COLUMN IF NOT EXISTS last_lng numeric;
ALTER TABLE public.entregadores ADD COLUMN IF NOT EXISTS last_location_at timestamptz;
ALTER TABLE public.entregadores ADD COLUMN IF NOT EXISTS last_location_order_id uuid;
ALTER TABLE public.entregadores ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.entregadores ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.entregadores ADD COLUMN IF NOT EXISTS password text;
ALTER TABLE public.entregadores ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.entregadores ADD COLUMN IF NOT EXISTS username text;
GRANT SELECT ON public.entregadores TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entregadores TO authenticated;
GRANT ALL ON public.entregadores TO service_role;

CREATE TABLE IF NOT EXISTS public.entregas_log (
  created_at timestamptz default now(),
  delivered_at timestamptz,
  entregador_id uuid,
  id uuid primary key default gen_random_uuid(),
  order_id uuid,
  organization_id uuid
);
ALTER TABLE public.entregas_log ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.entregas_log ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE public.entregas_log ADD COLUMN IF NOT EXISTS entregador_id uuid;
ALTER TABLE public.entregas_log ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE public.entregas_log ADD COLUMN IF NOT EXISTS organization_id uuid;
GRANT SELECT ON public.entregas_log TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entregas_log TO authenticated;
GRANT ALL ON public.entregas_log TO service_role;

CREATE TABLE IF NOT EXISTS public.features (
  category text,
  created_at timestamptz default now(),
  description text,
  id uuid primary key default gen_random_uuid(),
  key text,
  name text,
  sort_order numeric,
  updated_at timestamptz default now()
);
ALTER TABLE public.features ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.features ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.features ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.features ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE public.features ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.features ADD COLUMN IF NOT EXISTS sort_order numeric;
ALTER TABLE public.features ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.features TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.features TO authenticated;
GRANT ALL ON public.features TO service_role;

CREATE TABLE IF NOT EXISTS public.ingredientes (
  alerta_vencimento boolean,
  created_at timestamptz default now(),
  data_vencimento text,
  disponivel boolean,
  estoque_atual numeric,
  estoque_minimo numeric,
  id uuid primary key default gen_random_uuid(),
  last_alert_at timestamptz,
  lote text,
  nome text,
  organization_id uuid,
  unidade text,
  updated_at timestamptz default now()
);
ALTER TABLE public.ingredientes ADD COLUMN IF NOT EXISTS alerta_vencimento boolean;
ALTER TABLE public.ingredientes ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.ingredientes ADD COLUMN IF NOT EXISTS data_vencimento text;
ALTER TABLE public.ingredientes ADD COLUMN IF NOT EXISTS disponivel boolean;
ALTER TABLE public.ingredientes ADD COLUMN IF NOT EXISTS estoque_atual numeric;
ALTER TABLE public.ingredientes ADD COLUMN IF NOT EXISTS estoque_minimo numeric;
ALTER TABLE public.ingredientes ADD COLUMN IF NOT EXISTS last_alert_at timestamptz;
ALTER TABLE public.ingredientes ADD COLUMN IF NOT EXISTS lote text;
ALTER TABLE public.ingredientes ADD COLUMN IF NOT EXISTS nome text;
ALTER TABLE public.ingredientes ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.ingredientes ADD COLUMN IF NOT EXISTS unidade text;
ALTER TABLE public.ingredientes ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.ingredientes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredientes TO authenticated;
GRANT ALL ON public.ingredientes TO service_role;

CREATE TABLE IF NOT EXISTS public.logs_impressao (
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  message text,
  order_id uuid,
  organization_id uuid,
  payload_size numeric,
  printer_ip text,
  status text
);
ALTER TABLE public.logs_impressao ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.logs_impressao ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.logs_impressao ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE public.logs_impressao ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.logs_impressao ADD COLUMN IF NOT EXISTS payload_size numeric;
ALTER TABLE public.logs_impressao ADD COLUMN IF NOT EXISTS printer_ip text;
ALTER TABLE public.logs_impressao ADD COLUMN IF NOT EXISTS status text;
GRANT SELECT ON public.logs_impressao TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logs_impressao TO authenticated;
GRANT ALL ON public.logs_impressao TO service_role;

CREATE TABLE IF NOT EXISTS public.loja_temas (
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  mode text,
  organization_id uuid,
  primary_color text,
  secondary_color text,
  updated_at timestamptz default now()
);
ALTER TABLE public.loja_temas ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.loja_temas ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE public.loja_temas ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.loja_temas ADD COLUMN IF NOT EXISTS primary_color text;
ALTER TABLE public.loja_temas ADD COLUMN IF NOT EXISTS secondary_color text;
ALTER TABLE public.loja_temas ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.loja_temas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loja_temas TO authenticated;
GRANT ALL ON public.loja_temas TO service_role;

CREATE TABLE IF NOT EXISTS public.operadores_pdv (
  active boolean,
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  name text,
  organization_id uuid,
  password text,
  updated_at timestamptz default now(),
  username text
);
ALTER TABLE public.operadores_pdv ADD COLUMN IF NOT EXISTS active boolean;
ALTER TABLE public.operadores_pdv ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.operadores_pdv ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.operadores_pdv ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.operadores_pdv ADD COLUMN IF NOT EXISTS password text;
ALTER TABLE public.operadores_pdv ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.operadores_pdv ADD COLUMN IF NOT EXISTS username text;
GRANT SELECT ON public.operadores_pdv TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operadores_pdv TO authenticated;
GRANT ALL ON public.operadores_pdv TO service_role;

CREATE TABLE IF NOT EXISTS public.order_cancellations (
  cancelled_by text,
  cancelled_by_kind text,
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  order_id uuid,
  organization_id uuid,
  previous_status text,
  reason text
);
ALTER TABLE public.order_cancellations ADD COLUMN IF NOT EXISTS cancelled_by text;
ALTER TABLE public.order_cancellations ADD COLUMN IF NOT EXISTS cancelled_by_kind text;
ALTER TABLE public.order_cancellations ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.order_cancellations ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE public.order_cancellations ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.order_cancellations ADD COLUMN IF NOT EXISTS previous_status text;
ALTER TABLE public.order_cancellations ADD COLUMN IF NOT EXISTS reason text;
GRANT SELECT ON public.order_cancellations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_cancellations TO authenticated;
GRANT ALL ON public.order_cancellations TO service_role;

CREATE TABLE IF NOT EXISTS public.orders (
  bairro_id uuid,
  bairro_nome text,
  created_at timestamptz default now(),
  customer_cpf text,
  customer_name text,
  customer_phone text,
  data_reembolso text,
  delivery_address text,
  delivery_cep text,
  delivery_code text,
  delivery_distance_km numeric,
  delivery_fee numeric,
  delivery_recipient text,
  delivery_reference text,
  entregador_id uuid,
  id uuid primary key default gen_random_uuid(),
  items jsonb,
  nfe_numero text,
  nfe_status text,
  nfe_url text,
  notes text,
  order_number text,
  order_type text,
  organization_id uuid,
  payment_method text,
  print_attempts numeric,
  print_error text,
  print_status text,
  printed_at timestamptz,
  scheduled_for text,
  status text,
  status_reembolso text,
  total numeric,
  updated_at timestamptz default now(),
  user_id uuid
);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bairro_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bairro_nome text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_cpf text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS data_reembolso text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_address text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_cep text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_code text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_distance_km numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_fee numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_recipient text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_reference text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS entregador_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS items jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS nfe_numero text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS nfe_status text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS nfe_url text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_number text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_type text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS print_attempts numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS print_error text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS print_status text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS printed_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_for text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status_reembolso text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS user_id uuid;
GRANT SELECT ON public.orders TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

CREATE TABLE IF NOT EXISTS public.organizations (
  categoria text,
  city text,
  cnpj text,
  created_at timestamptz default now(),
  endereco_bairro text,
  endereco_cep text,
  endereco_estado text,
  endereco_numero text,
  endereco_rua text,
  id uuid primary key default gen_random_uuid(),
  instagram text,
  logo_url text,
  master_id uuid,
  mp_next_charge_at timestamptz,
  mp_subscription_amount numeric,
  mp_subscription_id uuid,
  name text,
  owner_id uuid,
  paused boolean,
  plan_id uuid,
  slug text,
  status_assinatura text,
  telefone text,
  updated_at timestamptz default now()
);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS categoria text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS cnpj text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS endereco_bairro text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS endereco_cep text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS endereco_estado text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS endereco_numero text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS endereco_rua text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS instagram text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS master_id uuid;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS mp_next_charge_at timestamptz;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS mp_subscription_amount numeric;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS mp_subscription_id uuid;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS owner_id uuid;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS paused boolean;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS plan_id uuid;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS status_assinatura text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS telefone text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.organizations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;

CREATE TABLE IF NOT EXISTS public.parceria_cupons (
  codigo text,
  created_at timestamptz default now(),
  customer_phone text,
  discount_percent numeric,
  id uuid primary key default gen_random_uuid(),
  order_id uuid,
  org_origem text,
  org_parceira text,
  parceria_id uuid,
  used boolean
);
ALTER TABLE public.parceria_cupons ADD COLUMN IF NOT EXISTS codigo text;
ALTER TABLE public.parceria_cupons ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.parceria_cupons ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE public.parceria_cupons ADD COLUMN IF NOT EXISTS discount_percent numeric;
ALTER TABLE public.parceria_cupons ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE public.parceria_cupons ADD COLUMN IF NOT EXISTS org_origem text;
ALTER TABLE public.parceria_cupons ADD COLUMN IF NOT EXISTS org_parceira text;
ALTER TABLE public.parceria_cupons ADD COLUMN IF NOT EXISTS parceria_id uuid;
ALTER TABLE public.parceria_cupons ADD COLUMN IF NOT EXISTS used boolean;
GRANT SELECT ON public.parceria_cupons TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parceria_cupons TO authenticated;
GRANT ALL ON public.parceria_cupons TO service_role;

CREATE TABLE IF NOT EXISTS public.parcerias (
  created_at timestamptz default now(),
  discount_percent numeric,
  habilitada_origem boolean,
  habilitada_parceira boolean,
  id uuid primary key default gen_random_uuid(),
  min_order_value numeric,
  org_origem text,
  org_parceira text,
  status text,
  updated_at timestamptz default now()
);
ALTER TABLE public.parcerias ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.parcerias ADD COLUMN IF NOT EXISTS discount_percent numeric;
ALTER TABLE public.parcerias ADD COLUMN IF NOT EXISTS habilitada_origem boolean;
ALTER TABLE public.parcerias ADD COLUMN IF NOT EXISTS habilitada_parceira boolean;
ALTER TABLE public.parcerias ADD COLUMN IF NOT EXISTS min_order_value numeric;
ALTER TABLE public.parcerias ADD COLUMN IF NOT EXISTS org_origem text;
ALTER TABLE public.parcerias ADD COLUMN IF NOT EXISTS org_parceira text;
ALTER TABLE public.parcerias ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.parcerias ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.parcerias TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parcerias TO authenticated;
GRANT ALL ON public.parcerias TO service_role;

CREATE TABLE IF NOT EXISTS public.pedidos_carimbados (
  created_at timestamptz default now(),
  order_id uuid,
  organization_id uuid,
  telefone_cliente text
);
ALTER TABLE public.pedidos_carimbados ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.pedidos_carimbados ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE public.pedidos_carimbados ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.pedidos_carimbados ADD COLUMN IF NOT EXISTS telefone_cliente text;
GRANT SELECT ON public.pedidos_carimbados TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedidos_carimbados TO authenticated;
GRANT ALL ON public.pedidos_carimbados TO service_role;

CREATE TABLE IF NOT EXISTS public.plan_audit_log (
  action text,
  actor_email text,
  actor_id uuid,
  created_at timestamptz default now(),
  feature_id uuid,
  feature_key text,
  feature_name text,
  id uuid primary key default gen_random_uuid(),
  new_value boolean,
  plan_id uuid,
  plan_key text,
  plan_name text,
  previous_value boolean
);
ALTER TABLE public.plan_audit_log ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.plan_audit_log ADD COLUMN IF NOT EXISTS actor_email text;
ALTER TABLE public.plan_audit_log ADD COLUMN IF NOT EXISTS actor_id uuid;
ALTER TABLE public.plan_audit_log ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.plan_audit_log ADD COLUMN IF NOT EXISTS feature_id uuid;
ALTER TABLE public.plan_audit_log ADD COLUMN IF NOT EXISTS feature_key text;
ALTER TABLE public.plan_audit_log ADD COLUMN IF NOT EXISTS feature_name text;
ALTER TABLE public.plan_audit_log ADD COLUMN IF NOT EXISTS new_value boolean;
ALTER TABLE public.plan_audit_log ADD COLUMN IF NOT EXISTS plan_id uuid;
ALTER TABLE public.plan_audit_log ADD COLUMN IF NOT EXISTS plan_key text;
ALTER TABLE public.plan_audit_log ADD COLUMN IF NOT EXISTS plan_name text;
ALTER TABLE public.plan_audit_log ADD COLUMN IF NOT EXISTS previous_value boolean;
GRANT SELECT ON public.plan_audit_log TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_audit_log TO authenticated;
GRANT ALL ON public.plan_audit_log TO service_role;

CREATE TABLE IF NOT EXISTS public.plan_features (
  created_at timestamptz default now(),
  enabled boolean,
  feature_id uuid,
  id uuid primary key default gen_random_uuid(),
  plan_id uuid,
  updated_at timestamptz default now()
);
ALTER TABLE public.plan_features ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.plan_features ADD COLUMN IF NOT EXISTS enabled boolean;
ALTER TABLE public.plan_features ADD COLUMN IF NOT EXISTS feature_id uuid;
ALTER TABLE public.plan_features ADD COLUMN IF NOT EXISTS plan_id uuid;
ALTER TABLE public.plan_features ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.plan_features TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_features TO authenticated;
GRANT ALL ON public.plan_features TO service_role;

CREATE TABLE IF NOT EXISTS public.plans (
  created_at timestamptz default now(),
  description text,
  id uuid primary key default gen_random_uuid(),
  key text,
  name text,
  sort_order numeric,
  updated_at timestamptz default now()
);
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS sort_order numeric;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.plans TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;

CREATE TABLE IF NOT EXISTS public.product_reviews (
  comment text,
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  order_id uuid,
  organization_id uuid,
  product_id uuid,
  rating numeric,
  user_id uuid
);
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS comment text;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS product_id uuid;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS rating numeric;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS user_id uuid;
GRANT SELECT ON public.product_reviews TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_reviews TO authenticated;
GRANT ALL ON public.product_reviews TO service_role;

CREATE TABLE IF NOT EXISTS public.products (
  alerta_vencimento boolean,
  available boolean,
  category text,
  codigo_barras text,
  created_at timestamptz default now(),
  data_vencimento text,
  description text,
  extras jsonb,
  id uuid primary key default gen_random_uuid(),
  image text,
  ingredients jsonb,
  is_combo boolean,
  lote text,
  low_stock_threshold numeric,
  manage_stock boolean,
  name text,
  organization_id uuid,
  prep_time_min numeric,
  price numeric,
  removable_ingredients jsonb,
  sold_by_weight boolean,
  stock_quantity numeric,
  updated_at timestamptz default now()
);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS alerta_vencimento boolean;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS available boolean;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS codigo_barras text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS data_vencimento text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS extras jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ingredients jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_combo boolean;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS lote text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS low_stock_threshold numeric;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS manage_stock boolean;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS prep_time_min numeric;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price numeric;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS removable_ingredients jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sold_by_weight boolean;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_quantity numeric;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;

CREATE TABLE IF NOT EXISTS public.profiles (
  created_at timestamptz default now(),
  display_name text,
  email text,
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  origem_assinatura_empresa_id uuid,
  phone text,
  recovery_pin_hash text,
  updated_at timestamptz default now(),
  user_id uuid
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS origem_assinatura_empresa_id uuid;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS recovery_pin_hash text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_id uuid;
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

CREATE TABLE IF NOT EXISTS public.progresso_fidelidade (
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  premios_resgatados numeric,
  quantidade_carimbos numeric,
  telefone_cliente text,
  ultimo_pedido_id uuid,
  updated_at timestamptz default now()
);
ALTER TABLE public.progresso_fidelidade ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.progresso_fidelidade ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.progresso_fidelidade ADD COLUMN IF NOT EXISTS premios_resgatados numeric;
ALTER TABLE public.progresso_fidelidade ADD COLUMN IF NOT EXISTS quantidade_carimbos numeric;
ALTER TABLE public.progresso_fidelidade ADD COLUMN IF NOT EXISTS telefone_cliente text;
ALTER TABLE public.progresso_fidelidade ADD COLUMN IF NOT EXISTS ultimo_pedido_id uuid;
ALTER TABLE public.progresso_fidelidade ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.progresso_fidelidade TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.progresso_fidelidade TO authenticated;
GRANT ALL ON public.progresso_fidelidade TO service_role;

CREATE TABLE IF NOT EXISTS public.receitas (
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  ingrediente_id uuid,
  organization_id uuid,
  product_id uuid,
  quantidade numeric,
  updated_at timestamptz default now()
);
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS ingrediente_id uuid;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS product_id uuid;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS quantidade numeric;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
GRANT SELECT ON public.receitas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receitas TO authenticated;
GRANT ALL ON public.receitas TO service_role;

CREATE TABLE IF NOT EXISTS public.resgates_fidelidade (
  codigo_resgate text,
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  premio_imagem text,
  premio_texto text,
  status text,
  telefone_cliente text,
  used_at timestamptz,
  used_by_user text
);
ALTER TABLE public.resgates_fidelidade ADD COLUMN IF NOT EXISTS codigo_resgate text;
ALTER TABLE public.resgates_fidelidade ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.resgates_fidelidade ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.resgates_fidelidade ADD COLUMN IF NOT EXISTS premio_imagem text;
ALTER TABLE public.resgates_fidelidade ADD COLUMN IF NOT EXISTS premio_texto text;
ALTER TABLE public.resgates_fidelidade ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.resgates_fidelidade ADD COLUMN IF NOT EXISTS telefone_cliente text;
ALTER TABLE public.resgates_fidelidade ADD COLUMN IF NOT EXISTS used_at timestamptz;
ALTER TABLE public.resgates_fidelidade ADD COLUMN IF NOT EXISTS used_by_user text;
GRANT SELECT ON public.resgates_fidelidade TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resgates_fidelidade TO authenticated;
GRANT ALL ON public.resgates_fidelidade TO service_role;

CREATE TABLE IF NOT EXISTS public.senhas_chamadas (
  called_at timestamptz,
  called_by text,
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  numero text,
  organization_id uuid,
  tipo text
);
ALTER TABLE public.senhas_chamadas ADD COLUMN IF NOT EXISTS called_at timestamptz;
ALTER TABLE public.senhas_chamadas ADD COLUMN IF NOT EXISTS called_by text;
ALTER TABLE public.senhas_chamadas ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.senhas_chamadas ADD COLUMN IF NOT EXISTS numero text;
ALTER TABLE public.senhas_chamadas ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.senhas_chamadas ADD COLUMN IF NOT EXISTS tipo text;
GRANT SELECT ON public.senhas_chamadas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.senhas_chamadas TO authenticated;
GRANT ALL ON public.senhas_chamadas TO service_role;

CREATE TABLE IF NOT EXISTS public.settings (
  balanca_baud_rate numeric,
  balanca_modelo text,
  banners jsonb,
  business_hours jsonb,
  categories jsonb,
  category_icons jsonb,
  cep_lat numeric,
  cep_lng numeric,
  cep_loja text,
  closed_message text,
  combo jsonb,
  cover_image text,
  created_at timestamptz default now(),
  delivery_assignment_mode text,
  delivery_enabled boolean,
  delivery_horario_fim text,
  delivery_horario_inicio text,
  delivery_mode text,
  delivery_pedido_minimo numeric,
  delivery_raio_km numeric,
  delivery_taxa_base numeric,
  delivery_taxa_por_km numeric,
  delivery_tempo_base_min numeric,
  delivery_tempo_por_km_min numeric,
  emergency_closed boolean,
  estoque_webhook_url text,
  fiscal_cnpj text,
  fiscal_csc text,
  fiscal_enabled boolean,
  fiscal_ie text,
  fiscal_razao text,
  fiscal_regime text,
  fiscal_token text,
  id uuid primary key default gen_random_uuid(),
  instagram_url text,
  mp_access_token text,
  mp_access_token_secret_id uuid,
  mp_client_id_secret_id uuid,
  mp_public_key text,
  mp_public_key_secret_id uuid,
  mp_terminal_id uuid,
  onesignal_api_key text,
  onesignal_app_id uuid,
  organization_id uuid,
  pay_card_online_enabled boolean,
  pay_card_terminal_enabled boolean,
  pay_cash_enabled boolean,
  pay_pix_enabled boolean,
  pix_key_manual text,
  scheduling_enabled boolean,
  share_image text,
  store_name text,
  taxa_vision_percent numeric,
  updated_at timestamptz default now(),
  whatsapp_number text
);
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS balanca_baud_rate numeric;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS balanca_modelo text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS banners jsonb;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS business_hours jsonb;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS categories jsonb;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS category_icons jsonb;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS cep_lat numeric;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS cep_lng numeric;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS cep_loja text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS closed_message text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS combo jsonb;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS cover_image text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS delivery_assignment_mode text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS delivery_enabled boolean;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS delivery_horario_fim text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS delivery_horario_inicio text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS delivery_mode text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS delivery_pedido_minimo numeric;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS delivery_raio_km numeric;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS delivery_taxa_base numeric;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS delivery_taxa_por_km numeric;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS delivery_tempo_base_min numeric;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS delivery_tempo_por_km_min numeric;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS emergency_closed boolean;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS estoque_webhook_url text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS fiscal_cnpj text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS fiscal_csc text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS fiscal_enabled boolean;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS fiscal_ie text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS fiscal_razao text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS fiscal_regime text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS fiscal_token text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS instagram_url text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_access_token text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_access_token_secret_id uuid;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_client_id_secret_id uuid;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_public_key text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_public_key_secret_id uuid;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_terminal_id uuid;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS onesignal_api_key text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS onesignal_app_id uuid;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pay_card_online_enabled boolean;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pay_card_terminal_enabled boolean;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pay_cash_enabled boolean;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pay_pix_enabled boolean;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pix_key_manual text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS scheduling_enabled boolean;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS share_image text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS store_name text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS taxa_vision_percent numeric;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS whatsapp_number text;
GRANT SELECT ON public.settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;

CREATE TABLE IF NOT EXISTS public.system_settings (
  id uuid primary key default gen_random_uuid(),
  mp_master_token_secret_id uuid,
  onesignal_api_key text,
  onesignal_app_id uuid,
  updated_at timestamptz default now(),
  valor_plano_padrao numeric
);
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS mp_master_token_secret_id uuid;
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS onesignal_api_key text;
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS onesignal_app_id uuid;
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS valor_plano_padrao numeric;
GRANT SELECT ON public.system_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;

CREATE TABLE IF NOT EXISTS public.taxas_entrega (
  ativo boolean,
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  nome_bairro text,
  organization_id uuid,
  tempo_estimado numeric,
  updated_at timestamptz default now(),
  valor_taxa numeric
);
ALTER TABLE public.taxas_entrega ADD COLUMN IF NOT EXISTS ativo boolean;
ALTER TABLE public.taxas_entrega ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.taxas_entrega ADD COLUMN IF NOT EXISTS nome_bairro text;
ALTER TABLE public.taxas_entrega ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.taxas_entrega ADD COLUMN IF NOT EXISTS tempo_estimado numeric;
ALTER TABLE public.taxas_entrega ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.taxas_entrega ADD COLUMN IF NOT EXISTS valor_taxa numeric;
GRANT SELECT ON public.taxas_entrega TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.taxas_entrega TO authenticated;
GRANT ALL ON public.taxas_entrega TO service_role;

CREATE TABLE IF NOT EXISTS public.teste_conexao (
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  resultado text
);
ALTER TABLE public.teste_conexao ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.teste_conexao ADD COLUMN IF NOT EXISTS resultado text;
GRANT SELECT ON public.teste_conexao TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teste_conexao TO authenticated;
GRANT ALL ON public.teste_conexao TO service_role;

CREATE TABLE IF NOT EXISTS public.user_roles (
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  role jsonb,
  user_id uuid
);
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS role jsonb;
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS user_id uuid;
GRANT SELECT ON public.user_roles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

CREATE TABLE IF NOT EXISTS public.vision_prime_assinaturas (
  created_at timestamptz default now(),
  expires_at timestamptz,
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  started_at timestamptz,
  status text,
  updated_at timestamptz default now(),
  user_id uuid
);
ALTER TABLE public.vision_prime_assinaturas ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.vision_prime_assinaturas ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.vision_prime_assinaturas ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.vision_prime_assinaturas ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.vision_prime_assinaturas ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.vision_prime_assinaturas ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.vision_prime_assinaturas ADD COLUMN IF NOT EXISTS user_id uuid;
GRANT SELECT ON public.vision_prime_assinaturas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vision_prime_assinaturas TO authenticated;
GRANT ALL ON public.vision_prime_assinaturas TO service_role;

CREATE TABLE IF NOT EXISTS public.vision_prime_config (
  ativo boolean,
  created_at timestamptz default now(),
  desconto_percentual numeric,
  frete_gratis_minimo numeric,
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  updated_at timestamptz default now(),
  valor_mensalidade numeric
);
ALTER TABLE public.vision_prime_config ADD COLUMN IF NOT EXISTS ativo boolean;
ALTER TABLE public.vision_prime_config ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.vision_prime_config ADD COLUMN IF NOT EXISTS desconto_percentual numeric;
ALTER TABLE public.vision_prime_config ADD COLUMN IF NOT EXISTS frete_gratis_minimo numeric;
ALTER TABLE public.vision_prime_config ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.vision_prime_config ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();
ALTER TABLE public.vision_prime_config ADD COLUMN IF NOT EXISTS valor_mensalidade numeric;
GRANT SELECT ON public.vision_prime_config TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vision_prime_config TO authenticated;
GRANT ALL ON public.vision_prime_config TO service_role;

CREATE TABLE IF NOT EXISTS public.v_financeiro_detalhado (
  created_at timestamptz default now(),
  customer_name text,
  order_id uuid,
  order_number text,
  organization_id uuid,
  payment_method text,
  status text,
  taxa_gateway_valor numeric,
  taxa_vision_valor numeric,
  valor_bruto numeric,
  valor_liquido_final numeric
);
ALTER TABLE public.v_financeiro_detalhado ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE public.v_financeiro_detalhado ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.v_financeiro_detalhado ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE public.v_financeiro_detalhado ADD COLUMN IF NOT EXISTS order_number text;
ALTER TABLE public.v_financeiro_detalhado ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.v_financeiro_detalhado ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.v_financeiro_detalhado ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.v_financeiro_detalhado ADD COLUMN IF NOT EXISTS taxa_gateway_valor numeric;
ALTER TABLE public.v_financeiro_detalhado ADD COLUMN IF NOT EXISTS taxa_vision_valor numeric;
ALTER TABLE public.v_financeiro_detalhado ADD COLUMN IF NOT EXISTS valor_bruto numeric;
ALTER TABLE public.v_financeiro_detalhado ADD COLUMN IF NOT EXISTS valor_liquido_final numeric;
GRANT SELECT ON public.v_financeiro_detalhado TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.v_financeiro_detalhado TO authenticated;
GRANT ALL ON public.v_financeiro_detalhado TO service_role;
