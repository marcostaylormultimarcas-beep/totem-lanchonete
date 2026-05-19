// Backend URL builder — usa exclusivamente as variáveis VITE_SUPABASE_URL do ambiente do Vite.
// Não usar fallbacks como window._env_, process.env ou URLs hardcoded.
export const getBackendFunctionUrl = (functionName: string, query?: Record<string, string>) => {
  const url = new URL(`/functions/v1/${functionName}`, import.meta.env.VITE_SUPABASE_URL);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  return url.toString();
};