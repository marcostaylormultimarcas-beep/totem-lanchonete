// Configuração canônica do backend do VisionFood.
//
// Projeto Supabase EXTERNO oficial: "Lanchonete final".
// Toda a stack (Auth, Tabelas em português, Functions e Triggers)
// foi migrada para este projeto nas Etapas 1 e 2.

export const SUPABASE_PROJECT_ID = 'udhcnpauymevkylldkir';

export const SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;

// Publishable/anon key oficial do projeto externo.
export const SUPABASE_PUBLISHABLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkaGNucGF1eW1ldmt5bGxka2lyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MzIzODYsImV4cCI6MjA3NzUwODM4Nn0.dQz4ZUeXNu3vLDGaqLh8vLZAqDrqoLwvXcHiiLR7cLM';

export const getSupabaseFunctionUrl = (functionName: string) =>
  `${SUPABASE_URL}/functions/v1/${functionName}`;

export const getSupabaseFunctionsHostUrl = (functionName: string) =>
  `https://${SUPABASE_PROJECT_ID}.functions.supabase.co/${functionName}`;
