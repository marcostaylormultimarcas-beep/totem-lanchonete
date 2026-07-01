import { SUPABASE_URL } from '@/config/supabaseConfig';

// Backend URL builder — usa a configuração canônica do Supabase do app.
export const getBackendFunctionUrl = (functionName: string, query?: Record<string, string>) => {
  const url = new URL(`/functions/v1/${functionName}`, SUPABASE_URL);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  return url.toString();
};