## Hierarquia de 3 Níveis: Super Admin → Master Admin → Admin Loja

### 1. Migração no Banco

**Enum `app_role`:** adicionar `super_admin` e `master_admin`. Manter `admin` (= lojista) e `master` (legado, mapeado como super_admin durante a transição).

**Tabela `organizations`:** adicionar coluna `master_id UUID` (nullable) — referencia o usuário Master que cadastrou a loja. Lojas criadas pelo Super Admin ficam com `master_id = NULL`.

**Função `has_role`:** já existe e funciona com o novo enum.

**Nova função `is_super_admin(uid)`:** retorna true se `user_roles` tem `super_admin` OU `master` (legado).

**Migração de dados:**
- Todo usuário com role `master` hoje vira `super_admin` (é você, dono).
- Usuários com role `admin` continuam como `admin` (lojistas).

**RLS atualizada:**
- `organizations`: 
  - SELECT: público (totem precisa ler por slug).
  - INSERT: `super_admin` (sem restrição) OU `master_admin` (apenas se `master_id = auth.uid()`) OU dono criando a própria.
  - UPDATE/DELETE: `super_admin`, OU `master_admin` se `master_id = auth.uid()`, OU owner.
- `user_roles`: 
  - SELECT: próprio usuário OU `super_admin` OU `master_admin` (para listar seus admins).
  - ALL: `super_admin`. Master pode INSERT/DELETE apenas role `admin` (para criar lojistas dele).
- `cupons`, `products`, `settings`, `orders`: adicionar `super_admin` e (via join em organizations) `master_admin` do master_id correspondente nas policies de owner.

### 2. Edge Function `admin-users`

Refatorar para suportar contexto hierárquico:
- Identificar caller: `super_admin`, `master_admin`, ou negar.
- `super_admin`: pode CRUD usuários `master_admin` E `admin`.
- `master_admin`: pode CRUD apenas usuários `admin` cujo `organizations.master_id = master_admin.id`.
- Ação `create`: aceita `role` (`master_admin` | `admin`) e, quando admin criado por master, grava `organizations.master_id` automaticamente.
- Ação `list`: filtra resultados conforme o role do caller.

### 3. Frontend

**`src/pages/Login.tsx`:** após login, ler roles e rotear:
- `super_admin` (ou legado `master`) → `/admin` (mostra aba Super)
- `master_admin` → `/admin` (mostra aba Master + suas lojas)
- `admin` → `/admin` (vê apenas sua loja)
- nenhum → erro + signOut

**`src/pages/Admin.tsx`:** controlar abas pela role:
- Super Admin vê aba **"Super"** (gerencia Masters) + **"Master"** (gerencia lojas globalmente) + lojas.
- Master Admin vê aba **"Master"** (gerencia apenas suas lojas e seus lojistas).
- Admin loja vê apenas painel da própria loja (sem abas Master/Super).

**Novo componente `src/components/admin/SuperAdminPanel.tsx`:**
- Formulário "Cadastrar novo Master Admin" (email, senha, nome).
- Lista de Masters com email, contagem de lojas, botões pausar/excluir.

**Atualizar `src/components/admin/AdminsPanel.tsx`** (renderizado para Master):
- Renomear contexto para "Meus Lojistas".
- Ao criar lojista, edge function vincula `organizations.master_id = currentUserId`.
- Lista filtra apenas lojistas vinculados.

**Atualizar `src/lib/auth.ts`:** adicionar `getCurrentUserRoleTier()` retornando `'super' | 'master' | 'admin' | null`.

### 4. Memória

Atualizar `mem://auth/admin` e índice para refletir a hierarquia de 3 níveis.

### Arquivos afetados
- migration nova (enum + coluna + RLS + dados)
- `supabase/functions/admin-users/index.ts`
- `src/pages/Login.tsx`, `src/pages/Admin.tsx`
- `src/components/admin/SuperAdminPanel.tsx` (novo)
- `src/components/admin/AdminsPanel.tsx`, `MasterPanel.tsx`
- `src/lib/auth.ts`
- `mem://auth/admin`, `mem://index.md`

Após aprovar o plano, começo pela migração (precisa da sua confirmação) e sigo com o código.