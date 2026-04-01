export interface Product {
  id: string;
  name: string;
  price: number;
  category: 'hamburgueres' | 'pizzas' | 'bebidas';
  image: string;
  removableIngredients: string[];
  extras: { name: string; price: number }[];
  isCombo?: boolean;
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

export interface StoreSettings {
  whatsappNumber: string;
  storeName: string;
  coverImage: string;
  combo: ComboSettings;
  banners: BannerItem[];
}

const ORDER_COUNT_KEY = 'visionmidia_order_count';

export function getNextOrderNumber(): string {
  const current = parseInt(localStorage.getItem(ORDER_COUNT_KEY) || '0', 10);
  const next = current + 1;
  localStorage.setItem(ORDER_COUNT_KEY, next.toString());
  return next.toString().padStart(3, '0');
}

const DEFAULT_PRODUCTS: Product[] = [
  {
    id: '1', name: 'X-Burguer Clássico', price: 25.90, category: 'hamburgueres',
    image: '🍔',
    removableIngredients: ['Cebola', 'Alface', 'Tomate', 'Picles'],
    extras: [{ name: 'Bacon', price: 5 }, { name: 'Queijo Extra', price: 4 }, { name: 'Ovo', price: 3 }],
  },
  {
    id: '2', name: 'X-Bacon Duplo', price: 32.90, category: 'hamburgueres',
    image: '🍔',
    removableIngredients: ['Cebola', 'Alface', 'Tomate'],
    extras: [{ name: 'Bacon Extra', price: 5 }, { name: 'Cheddar', price: 4 }],
  },
  {
    id: '3', name: 'Smash Burger', price: 28.90, category: 'hamburgueres',
    image: '🍔',
    removableIngredients: ['Cebola Caramelizada', 'Picles'],
    extras: [{ name: 'Blend Extra', price: 8 }, { name: 'Queijo Extra', price: 4 }],
  },
  {
    id: '4', name: 'Pizza Calabresa', price: 39.90, category: 'pizzas',
    image: '🍕',
    removableIngredients: ['Cebola', 'Azeitona'],
    extras: [{ name: 'Borda Recheada', price: 8 }, { name: 'Catupiry', price: 6 }],
  },
  {
    id: '5', name: 'Pizza Margherita', price: 35.90, category: 'pizzas',
    image: '🍕',
    removableIngredients: ['Manjericão', 'Tomate'],
    extras: [{ name: 'Borda Recheada', price: 8 }],
  },
  {
    id: '6', name: 'Pizza Frango c/ Catupiry', price: 42.90, category: 'pizzas',
    image: '🍕',
    removableIngredients: ['Milho', 'Catupiry'],
    extras: [{ name: 'Borda Recheada', price: 8 }, { name: 'Bacon', price: 5 }],
  },
  {
    id: '7', name: 'Coca-Cola 350ml', price: 6.90, category: 'bebidas',
    image: '🥤',
    removableIngredients: [],
    extras: [],
  },
  {
    id: '8', name: 'Suco Natural', price: 9.90, category: 'bebidas',
    image: '🧃',
    removableIngredients: [],
    extras: [{ name: 'Sem Açúcar', price: 0 }],
  },
  {
    id: '9', name: 'Água Mineral', price: 4.90, category: 'bebidas',
    image: '💧',
    removableIngredients: [],
    extras: [],
  },
];

const STORAGE_KEY = 'visionmidia_products';
const SETTINGS_KEY = 'visionmidia_settings';

export function getProducts(): Product[] {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PRODUCTS));
  return DEFAULT_PRODUCTS;
}

export function saveProducts(products: Product[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
}

const DEFAULT_COMBO: ComboSettings = { name: 'Batata + Refri', description: 'Batata + Refri', price: 15, emoji: '🍟🥤' };

const DEFAULT_BANNERS: BannerItem[] = [
  { id: '1', title: 'Combo do Dia', subtitle: 'Hambúrguer + Batata + Refri por R$29,90', image: '🍔🍟🥤', badgeText: '🔥 PROMO', badgeColor: 'secondary' },
  { id: '2', title: 'Frete Grátis', subtitle: 'Pedidos acima de R$50 não pagam entrega!', image: '🛵💨', badgeText: '✨ GRÁTIS', badgeColor: 'accent' },
  { id: '3', title: 'Pizza em Dobro', subtitle: 'Às terças, leve 2 e pague 1!', image: '🍕🍕', badgeText: '🎉 2x1', badgeColor: 'primary' },
];

export function getSettings(): StoreSettings {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    return { combo: DEFAULT_COMBO, coverImage: '', banners: DEFAULT_BANNERS, ...parsed };
  }
  const defaults: StoreSettings = { whatsappNumber: '5562994995768', storeName: 'Vision Mídia', coverImage: '', combo: DEFAULT_COMBO, banners: DEFAULT_BANNERS };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults));
  return defaults;
}

export function saveSettings(settings: StoreSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getItemTotal(item: CartItem): number {
  const extrasTotal = item.selectedExtras.reduce((sum, e) => sum + e.price, 0);
  return (item.product.price + extrasTotal) * item.quantity;
}

export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
