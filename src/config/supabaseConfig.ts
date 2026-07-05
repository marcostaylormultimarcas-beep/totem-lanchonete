// Configuração canônica do backend do VisionFood.
//
// Projeto Supabase EXTERNO oficial: "Lanchonete final" (udhcnpauymevkylldkir).
// Auth, tabelas em português, functions e triggers já foram migrados nas Etapas 1 e 2.

export const SUPABASE_PROJECT_ID = 'udhcnpauymevkylldkir';

export const SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;

// ANON KEY oficial do projeto externo "Lanchonete final" (udhcnpauymevkylldkir).
// Pode ser sobrescrita via VITE_SUPABASE_PUBLISHABLE_KEY no .env quando necessário.
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkaGNucGF1eW1ldmt5bGxka2lyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjc3MTMsImV4cCI6MjA5NDYwMzcxM30.4cRtA8yYnSi4VjXrmr605VmIgY8W0EfF0jqP9aiwwBk';

export const getSupabaseFunctionUrl = (functionName: string) =>
  `${SUPABASE_URL}/functions/v1/${functionName}`;

export const getSupabaseFunctionsHostUrl = (functionName: string) =>
  `https://${SUPABASE_PROJECT_ID}.functions.supabase.co/${functionName}`;
