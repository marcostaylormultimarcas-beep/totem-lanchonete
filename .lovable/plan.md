# Plano: Isolamento total por usuário (1 conta = 1 loja)

## Objetivo
Cada ADM = 1 conta autenticada via Supabase Auth = 1 loja totalmente isolada. Master gerencia tudo via role em `user_roles`. RLS real baseada em `auth.uid()`.

---

## 1. Banco de dados (migração SQL única)

### 1.1 Roles
- Criar enum `app_role` com valores `master` e `admin`.
- Criar tabela `user_roles (id, user_id → auth.users, role app_role, unique(user_id, role))`.
- Criar função SECURITY DEFINER `has_role(_user_id, _role)` para evitar recursão em RLS.

### 1.2 Substituir `organization_id` por `owner_id` (auth.users)
Cada tabela ganha `owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL`:
- `products.owner_id`
- `orders.owner_id`
- `settings.owner_id` (com unique constraint — 1 settings por dono)

### 1.3 Manter `organizations` para o slug público do totem
- `organizations` passa a ter `owner_id` (1:1 com user). Slug continua sendo a chave pública usada em `/loja/:slug`.
- Migração: para cada admin existente na tabela `admins`, criar um `auth.users` correspondente (via SQL com `auth.admin_create_user` não é possível em migração — então faremos backfill manual: criar usuário "demo" e migrar dados existentes para ele; ou deixar dados antigos órfãos com aviso).

**Decisão pragmática:** dados antigos ficarão atribuídos a um usuário "legado" criado manualmente pelo Master após login. Sem perda, mas será preciso reatribuir.

### 1.4 RLS real (substitui as policies abertas atuais)
Para cada tabela `products`, `orders`, `settings`, `organizations`:
- SELECT/INSERT/UPDATE/DELETE: `owner_id = auth.uid() OR has_role(auth.uid(), 'master')`

Exceções:
- `products`, `settings`, `organizations` precisam de SELECT público para o totem (`/loja/:slug`) funcionar sem login → policy adicional `FOR SELECT USING (true)` apenas no que é necessário renderizar.
- `orders` INSERT público (cliente faz pedido sem login) mas SELECT restrito ao dono.

### 1.5 Tabela `admins` legada
- Manter por compatibilidade temporária, mas marcar como deprecated. Toda lógica nova usa `auth.users` + `user_roles`.

---

## 2. Autenticação

### 2.1 `Auth.tsx` vira o login único
- Remove login custom da tabela `admins` em `Admin.tsx`.
- Toda autenticação passa por `supabase.auth.signInWithPassword` / `signUp` / Google OAuth (já existe).
- Após signup, trigger cria automaticamente: `profile`, `organization` (com slug = `user-{shortId}`), `settings` default, e role `admin` em `user_roles`.

### 2.2 Master
- Master é criado manualmente via `INSERT INTO user_roles (user_id, role) VALUES (<id>, 'master')` (ou via UI Master existente).
- Master vê todos via policy `has_role(auth.uid(), 'master')`.

### 2.3 Trigger `handle_new_user` ampliado
```sql
INSERT INTO profiles (...);
INSERT INTO organizations (owner_id, name, slug);
INSERT INTO settings (owner_id, organization_id, ...defaults);
INSERT INTO user_roles (user_id, role) VALUES (NEW.id, 'admin');
```

---

## 3. Frontend

### 3.1 `OrgContext` refatorado
- Para rotas autenticadas (`/admin`): `orgId` vem do `organization` do usuário logado (`auth.uid() → organizations.owner_id`).
- Para rota pública `/loja/:slug`: continua resolvendo por slug.
- Hook `useOrg()` continua igual; muda só a fonte.

### 3.2 `Admin.tsx`
- Remove login form custom.
- Se não logado → redireciona para `/auth`.
- Se logado → carrega org do usuário, mostra painel.
- Master vê switcher de organizações + aba "Usuários" (lista todos via Edge Function com service role, já que `auth.users` não é acessível direto pelo client).

### 3.3 `AdminsPanel.tsx` (Master only)
- Criar/pausar/excluir contas via **Edge Function** `admin-users` (precisa service role para `auth.admin.createUser`, `updateUserById`, `deleteUser`).
- "Pausar" = setar `banned_until` no auth.users via service role.

### 3.4 Limpeza de estado no logout
- Centralizar logout em helper `signOut()`:
  - `await supabase.auth.signOut()`
  - `localStorage.clear()` (preserva só `app_version`)
  - `queryClient.clear()`
  - `window.location.href = '/auth'`

### 3.5 `_redirects`
- Criar `public/_redirects` com `/* /index.html 200` (para deploys em Netlify; Lovable não usa, mas não atrapalha).

### 3.6 UX do switcher (Master)
- Substituir `<select>` por `Command` (combobox) com busca, indicador da org ativa, badge "pausada", e atalho "Criar nova organização".

---

## 4. Edge Function `admin-users`
Endpoints (todos verificam `has_role(caller, 'master')`):
- `POST /create` — `auth.admin.createUser` + cria org/settings/role.
- `POST /pause` — seta `banned_until = now() + 100 years`.
- `POST /unpause` — limpa `banned_until`.
- `DELETE /:id` — `auth.admin.deleteUser` (cascade via FK apaga tudo).
- `GET /list` — lista todos os usuários + orgs.

Config em `supabase/config.toml`:
```toml
[functions.admin-users]
verify_jwt = true
```

---

## 5. Arquivos

**Novos:**
- `supabase/migrations/<timestamp>_multi_tenant_per_user.sql`
- `supabase/functions/admin-users/index.ts`
- `public/_redirects`
- `src/lib/auth.ts` (helper signOut centralizado)

**Editados:**
- `src/pages/Admin.tsx` (remove login custom, usa supabase auth)
- `src/pages/Auth.tsx` (após login, redireciona para `/admin`)
- `src/contexts/OrgContext.tsx` (resolve org via `auth.uid()` quando logado)
- `src/components/admin/AdminsPanel.tsx` (chama edge function)
- `src/components/admin/OrganizationsPanel.tsx` (switcher melhorado)
- `src/components/admin/DashboardPanel.tsx`, `OrdersPanel.tsx` (queries continuam por orgId)
- `src/data/store.ts` (insere `owner_id` quando autenticado)
- `App.tsx` (sem mudança estrutural)

---

## 6. Detalhes técnicos

- **RLS pattern (exemplo `products`):**
  ```sql
  CREATE POLICY "Owner manages products" ON products
    FOR ALL USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'master'))
    WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(), 'master'));
  CREATE POLICY "Public reads products of active orgs" ON products
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM organizations o WHERE o.owner_id = products.owner_id AND NOT o.paused)
    );
  ```

- **Dados legados:** após a migração, os registros existentes ficam com `owner_id = NULL`. Vou atribuí-los a um usuário "legado" via INSERT manual (ou deixar visíveis só para Master até reatribuição). Confirme se quer essa abordagem.

- **Compatibilidade:** o totem público (`/loja/:slug`) continua funcionando porque as policies têm SELECT público filtrado por slug/organização ativa.

---

## 7. Riscos
- Login custom da tabela `admins` será desativado. Usuários atuais precisarão se recadastrar via `/auth` (ou Master pode pré-criar contas).
- Migração não consegue criar `auth.users` automaticamente — admins atuais perdem acesso até serem recriados.

**Quer que eu siga com este plano? Confirme também: criar um usuário "legado" para herdar os dados atuais, ou começar zerado?**