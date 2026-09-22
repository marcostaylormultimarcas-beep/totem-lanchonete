// Retorna o caminho público do cardápio preservando o slug atual quando não for informado.
export function getKioskHomePath(slug?: string | null): string {
  let storedSlug: string | null = null;

  if (!slug && typeof window !== 'undefined') {
    try {
      storedSlug = localStorage.getItem('kiosk_slug');
    } catch {
      storedSlug = null;
    }
  }

  const resolvedSlug = slug || storedSlug;
  return resolvedSlug ? `/cardapio/${resolvedSlug}` : '/';
}
