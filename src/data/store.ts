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
  manageStock?: boolean;
  stockQuantity?: number;
  lowStockThreshold?: number;
  /** Marcado pelo lojista: produto vendido por quilo (balança) */
  soldByWeight?: boolean;
  /** Código de barras EAN/UPC capturado por leitor */
  codigoBarras?: string;
}


export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  removedIngredients: string[];
  selectedExtras: { name: string; price: number }[];
  /** Peso em kg (apenas para produtos vendidos por quilo via balança) */
  weightKg?: number;
}

/** Detecta se um produto é vendido por peso (kg). Prioriza flag explícita do lojista. */
export function isByWeight(product: Product): boolean {
  if (product.soldByWeight) return true;
  const hay = `${product.category || ''} ${product.name || ''}`.toLowerCase();
  return /\b(kg|quilo|por\s*kg|\/kg|self[\s-]?service|por\s*peso)\b/.test(hay);
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
  /** ID do terminal/maquininha (Mercado Pago Point) */
  mpTerminalId?: string;
  /** Toggles de métodos de pagamento aceitos pela loja */
  payCashEnabled?: boolean;
  payPixEnabled?: boolean;
  payCardTerminalEnabled?: boolean;
  payCardOnlineEnabled?: boolean;
  /** Configurações Fiscais (NFe) — UI apenas, sem integração SEFAZ */
  fiscalEnabled?: boolean;
  fiscalCnpj?: string;
  fiscalRazao?: string;
  fiscalIe?: string;
  fiscalRegime?: string;
  fiscalCsc?: string;
  fiscalToken?: string;
  /** Marca da balança conectada via Web Serial (Toledo, Filizola, Urano, Elgin, Genérica) */
  balancaModelo?: 'toledo' | 'filizola' | 'urano' | 'elgin' | 'generic';
  /** Velocidade serial da balança (9600 ou 4800) */
  balancaBaudRate?: number;
}

// localStorage functions removed — all data now lives in Supabase

export function getItemTotal(item: CartItem): number {
  const extrasTotal = item.selectedExtras.reduce((sum, e) => sum + e.price, 0);
  const unit = item.product.price + extrasTotal;
  if (item.weightKg && item.weightKg > 0) {
    // Produto por peso: preço por kg × peso (quantidade ignorada/fixa em 1)
    return unit * item.weightKg;
  }
  return unit * item.quantity;
}

export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
