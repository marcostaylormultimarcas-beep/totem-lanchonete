// Retorna o caminho público do cardápio preservando o slug atual quando não for informado.
export function getKioskHomePath(slug?: string | null): string {
  const resolvedSlug = slug || (typeof window !== 'undefined' ? localStorage.getItem('kiosk_slug') : null);
  return resolvedSlug ? `/cardapio/${resolvedSlug}` : '/';
}
