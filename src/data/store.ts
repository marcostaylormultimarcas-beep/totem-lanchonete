export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  image: string;
  removableIngredients: string[];
  extras: { name: string; price: number }[];
  isCombo?: boolean;
  ingredients?: string[];
  description?: string;
}

export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  removedIngredients: string[];
  selectedExtras: { name: string; price: number }[];
}

export interface ComboSettings {
  name: string;
  description: string;
  price: number;
  emoji: string;
}

export interface BannerItem {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  badgeText: string;
  badgeColor: 'primary' | 'secondary' | 'accent';
}

export interface CategoryIcons {
  hamburgueres: string;
  pizzas: string;
  bebidas: string;
  [key: string]: string;
}

export interface CategoryItem {
  key: string;
  label: string;
  icon: string;
}

export interface ComboSettings {
  name: string;
  description: string;
  price: number;
  emoji: string;
  image?: string;
}

export interface StoreSettings {
  whatsappNumber: string;
  storeName: string;
  coverImage: string;
  combo: ComboSettings;
  banners: BannerItem[];
  categoryIcons: CategoryIcons;
  categories: CategoryItem[];
  instagramUrl?: string;
  deliveryEnabled?: boolean;
  /** Imagem usada como favicon e Open Graph quando o link da loja é compartilhado */
  shareImage?: string;
  /** Chave Pix em texto exibida abaixo do QR Code no pagamento */
  pixKeyManual?: string;
  /** Access Token do Mercado Pago (gera Pix real) */
  mpAccessToken?: string;
  /** Public Key do Mercado Pago */
  mpPublicKey?: string;
}

// localStorage functions removed — all data now lives in Supabase

export function getItemTotal(item: CartItem): number {
  const extrasTotal = item.selectedExtras.reduce((sum, e) => sum + e.price, 0);
  return (item.product.price + extrasTotal) * item.quantity;
}

export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
