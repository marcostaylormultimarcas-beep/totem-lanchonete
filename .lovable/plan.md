
## Parte 1 — Recuperação de senha (já implementado ✅)

O fluxo solicitado já está pronto no projeto:
- Botão **"Esqueci minha senha"** na tela `/auth` (modo `forgot`).
- Envia link via `supabase.auth.resetPasswordForEmail(email, { redirectTo: '/reset-password' })`.
- Página `/reset-password` valida a sessão de recuperação e chama `supabase.auth.updateUser({ password })`.
- Toasts de sucesso e erro (incluindo email não encontrado / link inválido).

**Opcional:** posso personalizar o template do email (logo + cores Dark Premium em laranja/dourado) usando o sistema de email do Lovable Cloud — só preciso que confirme se quer.

---

## Parte 2 — Arquitetura multi-tenant (mudança grande)

Hoje **todos os ADMs compartilham os mesmos dados** (uma única loja). Tornar multi-tenant significa que cada ADM vê só os dados da sua lanchonete (organização). Isto envolve mudanças profundas.

### Modelo de dados novo

```text
organizations (id, name, slug, paused, created_at)
admins        + organization_id  (cada ADM pertence a 1 organização)
products      + organization_id  (cardápio por loja)
orders        + organization_id  (pedidos por loja)
settings      + organization_id  (capa, banners, combo, categorias por loja)
```

- O **Master** (`is_master=true`) **não** pertence a uma organização: vê tudo e gerencia organizações + ADMs.
- Cada **ADM comum** é vinculado a exatamente 1 `organization_id`.
- Migração inicial: cria org "Loja Principal" e atribui todos os dados/ADMs existentes a ela (zero perda de dados).

### Fluxo Master (novo)
- Aba **"Organizações"** (apenas Master): criar, renomear, pausar, excluir lojas.
- Ao criar ADM, o Master escolhe a qual organização ele pertence.

### Fluxo ADM (mudado)
- Ao logar, o app carrega `organization_id` do admin e **todas** as queries (products, orders, settings, dashboard, banners, combo, categorias) filtram por esse id.
- Painel de pedidos, dashboard e configurações passam a mostrar só os dados da loja do ADM.

### Totem (frontend público)
Como o totem é acessado sem login, precisamos saber **qual loja** ele representa. Duas opções:

1. **URL com slug**: `/loja/pizzaria-do-ze` → totem dessa loja específica. (recomendado)
2. **Loja fixa por instalação**: cada totem grava o `organization_id` no `localStorage` na 1ª vez (configurado pelo ADM).

### Segurança (RLS)
Hoje todas as tabelas têm RLS aberta (`true`). Para multi-tenant real precisaria de auth Supabase para ADMs (hoje é login custom em tabela `admins` com senha em texto). Proposta:
- **Curto prazo:** filtragem por `organization_id` no client + RLS continua aberta (mantém arquitetura atual, baixo esforço).
- **Longo prazo (recomendado):** migrar ADMs para `auth.users` + `user_roles` + `has_role()` security definer + RLS real por organização. Mais seguro mas bem mais trabalhoso.

### Arquivos a tocar
- Migração SQL (nova tabela + colunas + backfill).
- `src/data/store.ts` — todas as funções fetch/insert recebem `organizationId`.
- `src/pages/Admin.tsx` — carrega `organization_id` do admin logado, propaga.
- `src/components/admin/*` (Orders, Dashboard, Admins, Settings, Products) — filtram/inserem com `organization_id`.
- Novo `src/components/admin/OrganizationsPanel.tsx` (Master).
- `src/components/kiosk/*` — recebem `organizationId` via contexto/URL.
- `App.tsx` — possível nova rota `/loja/:slug`.

---

## Decisões que preciso de você

1. **Como o totem identifica a loja?**
   - (a) URL `/loja/<slug>` (cada loja tem seu link)
   - (b) Configuração local salva no totem (1 totem = 1 loja fixa)

2. **RLS:** mantemos a abordagem atual (filtro só no client) ou faço a migração completa para `auth.users` + roles? (a 2ª é mais segura mas é refatoração grande do login do ADM)

3. **Email de recuperação:** quer que eu personalize o template com a marca Dark Premium agora?

Confirme essas 3 decisões e eu sigo com a implementação.
