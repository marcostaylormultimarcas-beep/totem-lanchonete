# PWA de Senhas (TV) + Integração no Painel Admin

## Visão geral
Criar um ecossistema de chamada de senhas em tempo real:
1. **TV/PWA** em `/painel-senhas/:slug` — tela cheia, instalável, exibe senha atual gigante + últimas 4
2. **Controles no Admin** — botão "Chamar próxima senha" + histórico
3. **Realtime via Supabase** + som de campainha automático
4. **PWA manifest-only** (sem service worker, conforme melhor prática — instalável mas sem cache que quebre preview)

## Parte 1 — Banco de dados (migração)
Nova tabela `senhas_chamadas`:
- `organization_id` (uuid)
- `numero` (text, ex: "A045")
- `tipo` (text: 'normal' | 'preferencial')
- `called_at` (timestamptz)
- `called_by` (uuid, opcional)

RLS:
- **Public SELECT** (TV precisa ler sem login via slug)
- **INSERT/UPDATE/DELETE** apenas pelo owner da organização
- Realtime habilitado (`ALTER PUBLICATION supabase_realtime ADD TABLE`)
- GRANT SELECT para anon + GRANT ALL para authenticated/service_role

## Parte 2 — Página TV (`src/pages/PainelSenhas.tsx`)
Rota nova: `/painel-senhas/:slug` (resolve org pelo slug, igual ao cardápio público).

**Layout 16:9 Dark Premium:**
```text
┌──────────────────────────────────────────────┐
│  SENHA ATUAL          │  ÚLTIMAS CHAMADAS   │
│                       │                      │
│      A045             │   A044              │
│  (text-9xl amber)     │   A043              │
│   glow neon           │   A042              │
│                       │   A041              │
│  Nome da Loja         │                      │
└──────────────────────────────────────────────┘
```

**Comportamento:**
- Fundo `bg-zinc-950`, sem scroll (`overflow-hidden h-screen`)
- Subscribe realtime na tabela `senhas_chamadas` filtrado por `organization_id`
- Ao receber nova senha: anima flash âmbar (3 piscadas), toca som "plim" (gerado via Web Audio API — sem precisar de arquivo externo)
- Mostra horário atual + nome da loja no rodapé
- Auto-hide cursor após 3s (modo TV)

## Parte 3 — PWA Manifest (apenas)
- Atualizar `public/manifest.json`: `name`, `short_name`, `display: "standalone"`, `start_url: "/painel-senhas"`, ícones, `theme_color: "#f59e0b"`, `background_color: "#09090b"`
- Adicionar `<link rel="manifest">` e meta tags PWA no `index.html` (se já não tiver)
- **Sem service worker** — evita problemas de cache no preview; instalável via "Adicionar à tela inicial"
- Banner sutil na página TV: "Toque em ⋮ → Adicionar à tela inicial" (primeira visita)

## Parte 4 — Controles no Admin
Novo painel `src/components/admin/SenhasPanel.tsx`:
- Input do prefixo (ex: "A") + contador automático ou manual
- Botão grande **"CHAMAR PRÓXIMA SENHA"** (amber gradient)
- Botão **"SENHA PREFERENCIAL"** (variant)
- Lista das últimas 10 chamadas com horário
- Botão **"Abrir TV em nova aba"** → `/painel-senhas/{slug}`
- Botão **"Limpar histórico do dia"**

Adicionar entrada no menu lateral do Admin (`src/pages/Admin.tsx`): "Painel de Senhas" no drawer.

## Parte 5 — Rota
Adicionar em `src/App.tsx`:
```tsx
<Route path="/painel-senhas/:slug" element={<PainelSenhas />} />
```

## Arquivos a criar/editar
**Criar:**
- `src/pages/PainelSenhas.tsx`
- `src/components/admin/SenhasPanel.tsx`
- Migração SQL `senhas_chamadas`

**Editar:**
- `src/App.tsx` (rota)
- `src/pages/Admin.tsx` (entrada no drawer)
- `public/manifest.json` (PWA config)
- `index.html` (meta PWA, se faltar)

## Observações técnicas
- **Som**: gerado por `AudioContext` (oscillator → 2 beeps "plim plim") — não precisa de arquivo de áudio
- **PWA preview**: instalação só funciona no domínio publicado (não no preview iframe da Lovable); vou avisar
- **Sem `service worker`**: cumpre as melhores práticas; basta o manifest para "Adicionar à tela inicial"
- Realtime já está configurado para outras tabelas — só preciso adicionar `senhas_chamadas` à publication
