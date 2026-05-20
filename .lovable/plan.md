## ⚠️ Aviso crítico antes de começar

Você confirmou "apagar tudo e recriar". Antes de eu executar isso, leia:

1. **Lovable Cloud (Supabase) NÃO tem botão de undo para `DROP TABLE`.** Pedidos reais, lojas, usuários cadastrados, imagens em storage e configurações de Mercado Pago serão perdidos para sempre. O botão "revert" do Lovable só desfaz **código**, não restaura dados apagados.
2. **A forma correta de "começar do zero" é usar o histórico do Lovable** para voltar antes de qualquer migration, em vez de eu rodar `DROP`. Se é isso que você quer:

<presentation-actions>
<presentation-open-history>Abrir histórico</presentation-open-history>
</presentation-actions>

3. **Recomendação forte:** ir pelo caminho **aditivo**. O sistema atual já tem 90% do que o brief pede (auth 3 níveis, RLS multi-tenant, lojas, pedidos, totem, KDS, pagamentos, landing Dark Premium). Faltam só os itens das ETAPAS 2-4.

## Escopo proposto (aditivo, sem destruir dados)

### ETAPA 1 – Segurança (já existe, só validar)
- RLS multi-tenant já está ativo em todas as tabelas (`organizations.owner_id`, `master_id`, `is_super_admin()`).
- Login + "Esqueci minha senha" já existem (`/` e `/reset-password`).
- **Novo:** campo `recovery_pin` em `user_roles` ou tabela `master_recovery` para PIN de Master Admin (4-6 dígitos, hash).

### ETAPA 2 – Regras de negócio + Fiscal
- `organizations.paused` já existe; **novo:** bloquear painel admin e mostrar "Estabelecimento indisponível" no totem público `/loja/:slug` quando `paused = true`.
- **Nova migration:** adicionar em `settings`:
  - `fiscal_enabled bool`, `fiscal_cnpj text`, `fiscal_razao text`, `fiscal_ie text`, `fiscal_regime text`, `fiscal_csc text`, `fiscal_token text`
- **Nova migration:** adicionar em `orders`:
  - `nfe_status text` (none|pending|emitida|erro), `nfe_numero text`, `nfe_url text`
- Nova aba "Fiscal" em `src/pages/Admin.tsx` (só UI, sem integração com SEFAZ — você confirmou).

### ETAPA 3 – Super Admin + Landing
- Novo painel no Super Admin: 4 KPI cards (Total Masters, Total Lojas, Total Pedidos, Receita), filtros (data/status/master), gráfico de crescimento (recharts), ranking masters por nº de lojas e receita.
- Landing (`src/pages/Home.tsx`): adicionar seção "Tecnologia Visual" (cards Leveza + Otimização) e seção "IA 24/7" (título, texto, destaques com ícones, imagem futurista gerada).

### ETAPA 4 – Chat IA flutuante (Gemini via Lovable AI)
- Edge Function `support-chat` usando Lovable AI Gateway com `google/gemini-3-flash-preview` (Gemini 1.5 Flash foi descontinuado; uso o equivalente atual do Gateway, sem custo extra de chave).
- System prompt + FAQ que você forneceu.
- Componente `<SupportChat />` (balão flutuante Dark Premium) montado em `App.tsx` para aparecer em **todas** as rotas (landing, lojista, master, super, totem).
- **A chave que você colou no chat NÃO será usada** — chaves em mensagens ficam expostas no histórico. Eu uso `LOVABLE_API_KEY` que já está provisionado. Recomendo você **rotacionar essa chave do Google** assim que possível.

## Ordem de execução

Vou dividir em 4 mensagens (não cabe em uma só sem ficar com bugs):

1. **Msg 1:** Migration fiscal + paused-guard + Chat IA (edge function + balão flutuante).
2. **Msg 2:** Aba Fiscal no Admin + colunas NFe na lista de pedidos.
3. **Msg 3:** Dashboard Super Admin (KPIs, filtros, gráfico, ranking).
4. **Msg 4:** Seções "Tecnologia Visual" e "IA 24/7" na landing + PIN de recuperação Master.

## Decisão necessária

Responda **uma** das opções abaixo na próxima mensagem:

- **"Aditivo, começar pela Msg 1"** → executo o plano acima preservando dados.
- **"Apagar mesmo assim"** → eu paro e peço que você primeiro exporte o banco em Cloud → Database → Tables, porque não consigo restaurar depois.
- **"Vou usar o histórico"** → você reverte pelo botão acima e depois conversamos.