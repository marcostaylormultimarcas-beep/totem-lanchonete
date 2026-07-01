// Configuração canônica do backend do VisionFood.
//
// O deploy publicado estava compilando com variáveis antigas do Netlify
// e apontando para outro projeto Supabase. Isso fazia o login autenticar
// em um banco diferente, sem as roles administrativas corretas.
//
// Como a aplicação e as migrations deste repositório pertencem ao projeto
// abaixo, mantemos estes valores como fonte da verdade do frontend.

export const SUPABASE_PROJECT_ID = 'upwstbeimnlgohbqogzz';

export const SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;

// Publishable/anon key: chave pública própria para uso no browser.
export const SUPABASE_PUBLISHABLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwd3N0YmVpbW5sZ29oYnF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwOTQ4NDQsImV4cCI6MjA5MDY3MDg0NH0.jTK21_zbLLcqPWAVSjOJCwAVrGJ7L6iftFyoppmdtJE';

export const getSupabaseFunctionUrl = (functionName: string) =>
  `${SUPABASE_URL}/functions/v1/${functionName}`;

export const getSupabaseFunctionsHostUrl = (functionName: string) =>
  `https://${SUPABASE_PROJECT_ID}.functions.supabase.co/${functionName}`;