/**
 * Detecta se o app está rodando em "modo demonstração" — usado pelo
 * Simulador Interativo da Landing Page (/home).
 *
 * Quando `?modo=demo` está presente na URL (ou foi detectado antes
 * nesta aba), o app NÃO grava pedidos no banco oficial e NÃO dispara
 * alertas no KDS — apenas simula visualmente o fluxo.
 *
 * Como o iframe da Landing Page só carrega `?modo=demo` na primeira
 * URL, persistimos a flag em `sessionStorage` para que ela continue
 * valendo em todas as rotas seguidas dentro daquele iframe (cardápio,
 * carrinho, checkout, pagamento).
 */
const STORAGE_KEY = 'kiosk-demo-mode';

export const isDemoMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('modo') === 'demo') {
      sessionStorage.setItem(STORAGE_KEY, '1');
      return true;
    }
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};
