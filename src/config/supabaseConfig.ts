// Configuração canônica do backend do VisionFood.
//
// Projeto Supabase EXTERNO oficial: "Lanchonete final" (udhcnpauymevkylldkir).
// Auth, tabelas em português, functions e triggers já foram migrados nas Etapas 1 e 2.

export const SUPABASE_PROJECT_ID = 'udhcnpauymevkylldkir';

export const SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;

// ANON KEY oficial do projeto externo "Lanchonete final" (udhcnpauymevkylldkir).
const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkaGNucGF1eW1ldmt5bGxka2lyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjc3MTMsImV4cCI6MjA5NDYwMzcxM30.4cRtA8yYnSi4VjXrmr605VmIgY8W0EfF0jqP9aiwwBk';

// Só aceita chave do .env se ela pertencer AO MESMO projeto (evita "Invalid API key"
// quando o ambiente ainda injeta a chave de um projeto antigo).
const belongsToProject = (key?: string) => {
  if (!key) return false;
  try {
    const payload = JSON.parse(atob(key.split('.')[1]));
    return payload?.ref === SUPABASE_PROJECT_ID;
  } catch {
    return false;
  }
};

const envKey =
  [import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, import.meta.env.VITE_SUPABASE_ANON_KEY].find(
    (k) => belongsToProject(k as string),
  ) as string | undefined;

export const SUPABASE_PUBLISHABLE_KEY = envKey || FALLBACK_ANON_KEY;

// Chave de storage isolada por projeto: sessões antigas de outro projeto
// não podem mais ser enviadas para este backend.
export const SUPABASE_AUTH_STORAGE_KEY = `sb-${SUPABASE_PROJECT_ID}-auth-token`;

// Limpa tokens de auth de outros projetos Supabase que ficaram no navegador.
export const purgeForeignSupabaseSessions = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    Object.keys(localStorage)
      .filter((k) => /^sb-.*-auth-token/.test(k) && !k.startsWith(`sb-${SUPABASE_PROJECT_ID}-`))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
};


export const getSupabaseFunctionUrl = (functionName: string) =>
  `${SUPABASE_URL}/functions/v1/${functionName}`;

export const getSupabaseFunctionsHostUrl = (functionName: string) =>
  `https://${SUPABASE_PROJECT_ID}.functions.supabase.co/${functionName}`;
