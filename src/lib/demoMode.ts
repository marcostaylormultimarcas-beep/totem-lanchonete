/**
 * Detecta se o app está rodando em "modo demonstração" — usado pelo
 * Simulador Interativo da Landing Page (/home).
 *
 * Quando ?modo=demo está presente na URL, o app NÃO grava pedidos
 * no banco oficial e NÃO dispara alertas no KDS — apenas simula
 * visualmente o fluxo para o cliente conhecer o produto.
 */
export const isDemoMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('modo') === 'demo';
  } catch {
    return false;
  }
};
