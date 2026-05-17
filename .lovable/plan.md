
## Diagnóstico

A tela preta no Netlify **não** é causada pelas tabelas — elas já existem. A causa é o cliente Supabase falhando na inicialização porque as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` **não existem no build do Netlify**.

No Lovable o arquivo `.env` é gerado automaticamente. No Netlify ele **não existe** — o Vite faz o build sem essas variáveis, então:

```ts
// src/integrations/supabase/client.ts
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;          // undefined
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY; // undefined
createClient(undefined, undefined) // 💥 throw → React não monta → tela preta
```

Como o `client.ts` é arquivo gerado (não devo editar), a correção precisa ser feita de duas formas:

## Plano

### 1. Configurar as variáveis no Netlify (ação do usuário — instruções claras)
No painel do Netlify: **Site settings → Environment variables → Add variable**, adicionar:

- `VITE_SUPABASE_URL` = `https://upwstbeimnlgohbqogzz.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY` = (a anon key do projeto)
- `VITE_SUPABASE_PROJECT_ID` = `upwstbeimnlgohbqogzz`

Depois clicar em **Deploys → Trigger deploy → Clear cache and deploy site**.

### 2. Adicionar tela de erro amigável (em vez de tela preta) quando faltar env
Criar um guard em `src/main.tsx` que detecta env ausentes e renderiza uma mensagem clara em vez de deixar o app crashar silenciosamente. Assim, se algo der errado no futuro, o usuário vê o que está faltando em vez de tela preta.

```tsx
// src/main.tsx
const hasEnv = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!hasEnv) {
  root.render(<MissingEnvScreen />); // tela explicativa com instruções
} else {
  root.render(<App />);
}
```

### 3. Adicionar ErrorBoundary no topo do App
Captura qualquer erro de runtime (ex: RLS bloqueando, query falhando no boot) e mostra mensagem em vez de tela preta.

### 4. Verificar `public/_redirects` para SPA fallback no Netlify
Garantir que existe `/* /index.html 200` para rotas como `/loja/:slug` não retornarem 404.

### 5. Publish
Após as mudanças, publicar para atualizar o site Lovable. **O Netlify é deploy separado** — o usuário precisa fazer o redeploy no painel do Netlify depois de configurar as env vars (passo 1).

## Observação importante

Não consigo configurar as variáveis do Netlify por você — isso é feito no painel do Netlify. Mas as mudanças de código (passos 2, 3, 4) vão fazer o app mostrar uma mensagem clara explicando o que falta, em vez de tela preta.

## Pergunta antes de implementar

Você quer que eu siga com o plano acima (guard + ErrorBoundary + checar _redirects), ou prefere que eu apenas confirme as instruções para configurar as variáveis no Netlify sem mexer no código?
