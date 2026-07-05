// Configuração canônica do backend do VisionFood.
//
// Projeto Supabase EXTERNO oficial: "Lanchonete final" (udhcnpauymevkylldkir).
// Auth, tabelas em português, functions e triggers já foram migrados nas Etapas 1 e 2.

export const SUPABASE_PROJECT_ID = 'udhcnpauymevkylldkir';

export const SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;

// ⚠️ Cole abaixo a ANON KEY completa do projeto externo (Settings → API → anon public).
// A chave enviada anteriormente no chat veio truncada, então mantenha o valor abaixo
// atualizado com a string completa (começa com "eyJ..." e tem ~200+ caracteres).
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'COLE_AQUI_A_ANON_KEY_COMPLETA_DO_PROJETO_EXTERNO';

export const getSupabaseFunctionUrl = (functionName: string) =>
  `${SUPABASE_URL}/functions/v1/${functionName}`;

export const getSupabaseFunctionsHostUrl = (functionName: string) =>
  `https://${SUPABASE_PROJECT_ID}.functions.supabase.co/${functionName}`;
