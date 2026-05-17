// Retorna o caminho "home" do totem preservando o slug da loja atual, se houver.
export function getKioskHomePath(): string {
  const slug = typeof window !== 'undefined' ? localStorage.getItem('kiosk_slug') : null;
  return slug ? `/cardapio/${slug}` : '/';
}
