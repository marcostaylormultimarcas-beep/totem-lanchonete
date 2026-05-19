## Objetivo
Eliminar qualquer referência antiga ao backend no frontend, garantir uso exclusivo das variáveis do Vite e disparar uma nova sincronização automática para o GitHub com uma alteração mínima e segura.

## O que vou implementar
1. Revisar e sanitizar os arquivos críticos do app (`src/lib/backend.ts`, `src/main.tsx`, telas de login/auth e quaisquer helpers usados no login) para remover:
   - URLs hardcoded do projeto antigo
   - chaves hardcoded
   - fallbacks como `|| window._env_`, `globalThis`, `process.env` ou equivalentes no cliente
2. Manter a leitura do backend exclusivamente por:
   - `import.meta.env.VITE_SUPABASE_URL`
   - `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`
3. Fazer uma pequena alteração não funcional em arquivos editáveis relevantes para disparar uma nova sincronização automática do código.
4. Validar no código e no preview que o login está usando apenas a configuração atual do Vite, sem referência residual ao host antigo.

## O que encontrei na exploração
- `src/integrations/supabase/client.ts` já está lendo apenas `import.meta.env.VITE_SUPABASE_URL` e `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`.
- `src/lib/backend.ts` já monta URLs a partir de `import.meta.env.VITE_SUPABASE_URL`.
- `src/main.tsx` e `vite.config.ts` estão limpos, sem fallback antigo.
- Não encontrei URL hardcoded antiga nos arquivos editáveis do `src/`.
- A URL antiga ainda aparece em artefatos/configuração auto-gerados (`.env` e `supabase/config.toml`), que não devem ser editados manualmente.

## Validação após a implementação
- Rodar nova varredura global por:
  - domínio antigo
  - `window._env_`
  - fallbacks de URL/chave
- Confirmar que os arquivos editáveis críticos ficaram limpos.
- Verificar no preview se o fluxo de login não tenta mais usar código com fallback local.
- Confirmar que houve nova alteração salva para acionar a sincronização automática.

## Detalhes técnicos
- Não vou editar `src/integrations/supabase/client.ts` se ele continuar auto-gerado e já estiver correto; a limpeza será feita apenas onde houver código editável de verdade.
- Como o cliente já depende do `import.meta.env`, se o erro persistir após a sanitização do código, a causa restante passa a ser a configuração de variáveis do ambiente de deploy, não código hardcoded no frontend.
- A implementação será mínima e sem risco de quebrar o build do Netlify.