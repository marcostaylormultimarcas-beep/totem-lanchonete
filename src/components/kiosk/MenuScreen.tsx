import { useState, useEffect } from 'react';
import { ArrowLeft, ShoppingCart, Plus, Search } from 'lucide-react';
import { getItemTotal, CartItem, Product, CategoryItem } from '@/data/store';
import { supabase } from '@/integrations/supabase/client';
import { useOrgId } from '@/contexts/OrgContext';
import ProductModal from './ProductModal';
import UpsellPopup from './UpsellPopup';
import { formatCurrency } from '@/data/store';

interface MenuScreenProps {
  cart: CartItem[];
  onAddToCart: (item: CartItem) => void;
  onGoToCart: () => void;
  onBack: () => void;
  initialProduct?: Product | null;
  onInitialProductHandled?: () => void;
}

const DEFAULT_CATEGORIES: CategoryItem[] = [
  { key: 'hamburgueres', label: 'Hambúrgueres', icon: '🍔' },
  { key: 'pizzas', label: 'Pizzas', icon: '🍕' },
  { key: 'bebidas', label: 'Bebidas', icon: '🥤' },
];

const MenuScreen = ({ cart, onAddToCart, onGoToCart, onBack, initialProduct, onInitialProductHandled }: MenuScreenProps) => {
  const orgId = useOrgId();
  const [categories, setCategories] = useState<CategoryItem[]>(DEFAULT_CATEGORIES);
  const [activeCategory, setActiveCategory] = useState<string>('hamburgueres');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showUpsell, setShowUpsell] = useState(false);
  const [pendingItem, setPendingItem] = useState<CartItem | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [combo, setCombo] = useState({ name: 'Batata + Refri', description: 'Batata + Refri', price: 15, emoji: '🍟🥤' });

  useEffect(() => {
    if (!orgId) return;
    const fetchData = async () => {
      const [{ data: prods }, { data: settingsData }] = await Promise.all([
        supabase.from('products').select('*').eq('organization_id', orgId),
        supabase.from('settings').select('combo, categories').eq('organization_id', orgId).maybeSingle(),
      ]);
      if (prods) {
        setProducts(prods.map((p: any) => ({
          id: p.id, name: p.name, price: Number(p.price), category: p.category,
          image: p.image, removableIngredients: (p.removable_ingredients as string[]) || [],
          extras: (p.extras as { name: string; price: number }[]) || [], isCombo: p.is_combo || false,
          ingredients: (p.ingredients as string[]) || [], description: p.description || '',
        })));
      }
      if (settingsData?.combo) setCombo(settingsData.combo as any);
      const cats = (settingsData as any)?.categories as CategoryItem[] | undefined;
      if (cats && cats.length > 0) {
        setCategories(cats);
        setActiveCategory(prev => cats.find(c => c.key === prev) ? prev : cats[0].key);
      }
    };
    fetchData();
  }, [orgId]);


  useEffect(() => {
    if (initialProduct) {
      setActiveCategory(initialProduct.category);
      setSelectedProduct(initialProduct);
      onInitialProductHandled?.();
    }
  }, [initialProduct, onInitialProductHandled]);

  const filtered = products.filter(p => p.category === activeCategory);
  const cartTotal = cart.reduce((sum, item) => {
    const extras = item.selectedExtras.reduce((s, e) => s + e.price, 0);
    return sum + (item.product.price + extras) * item.quantity;
  }, 0);

  const handleAddItem = (item: CartItem) => {
    if (item.product.category === 'hamburgueres' || item.product.category === 'pizzas') {
      setPendingItem(item);
      setShowUpsell(true);
    } else {
      onAddToCart(item);
    }
    setSelectedProduct(null);
  };

  const handleUpsellAccept = () => {
    if (pendingItem) {
      onAddToCart(pendingItem);
      const comboItem: CartItem = {
        id: crypto.randomUUID(),
        product: {
          id: 'combo-' + Date.now(),
          name: `Combo: ${combo.name}`,
          price: combo.price,
          category: 'bebidas',
          image: (combo as any).image || combo.emoji,
          removableIngredients: [],
          extras: [],
          isCombo: true,
        },
        quantity: 1,
        removedIngredients: [],
        selectedExtras: [],
      };
      onAddToCart(comboItem);
    }
    setShowUpsell(false);
    setPendingItem(null);
  };

  const handleUpsellDecline = () => {
    if (pendingItem) onAddToCart(pendingItem);
    setShowUpsell(false);
    setPendingItem(null);
  };

  const isUrl = (s: string) => s.startsWith('http') || s.startsWith('/');

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-zinc-950 text-zinc-100">
      {/* Blindagem visual: imagens sempre em cores originais */}
      <style>{`.menu-shell img{filter:none !important;-webkit-filter:none !important;mix-blend-mode:normal !important;opacity:1 !important;color-scheme:light !important;}`}</style>

      {/* Main content area */}
      <div className="menu-shell flex-1 flex flex-col pb-24 lg:pb-0">
        {/* Header sofisticado */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-800/80 bg-zinc-950/95 backdrop-blur-sm sticky top-0 z-20">
          <button onClick={onBack} className="text-zinc-400 hover:text-amber-300 transition-colors">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h2 className="text-base sm:text-lg font-bold tracking-wide text-white">
            Vision Mídia <span className="text-amber-400">Digital</span>
          </h2>
          <div className="flex items-center gap-3">
            <button className="text-amber-300/90 hover:text-amber-300 transition-colors" aria-label="Buscar">
              <Search className="w-5 h-5" />
            </button>
            <button onClick={onGoToCart} className="relative text-amber-300/90 hover:text-amber-300 transition-colors">
              <ShoppingCart className="w-6 h-6" />
              {cart.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-gradient-to-br from-amber-500 to-orange-600 text-zinc-950 text-[10px] font-black rounded-full w-5 h-5 flex items-center justify-center shadow-[0_0_10px_rgba(245,158,11,0.5)]">
                  {cart.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Categorias iluminadas */}
        <div className="flex gap-3 px-4 py-5 overflow-x-auto whitespace-nowrap">
          {categories.map(cat => {
            const active = activeCategory === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className="touch-btn flex flex-col items-center gap-2 flex-shrink-0 group"
              >
                <span
                  className={`relative w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-full flex items-center justify-center bg-zinc-900 border transition-all duration-300 overflow-hidden ${
                    active
                      ? 'border-transparent scale-110 shadow-[0_0_18px_rgba(245,158,11,0.45)]'
                      : 'border-zinc-800 group-hover:border-amber-500/40'
                  }`}
                  style={
                    active
                      ? { backgroundImage: 'linear-gradient(#18181b,#18181b), linear-gradient(135deg,#f59e0b,#ea580c)', backgroundOrigin: 'border-box', backgroundClip: 'padding-box, border-box', borderWidth: '2px', borderStyle: 'solid' }
                      : undefined
                  }
                >
                  {cat.icon && (isUrl(cat.icon)
                    ? <img src={cat.icon} alt="" className="w-full h-full object-cover rounded-full" />
                    : <span className={`text-3xl ${active ? 'scale-110' : ''} transition-transform`}>{cat.icon}</span>)}
                </span>
                <span className={`text-xs font-semibold ${active ? 'text-amber-400' : 'text-zinc-400 group-hover:text-zinc-200'} transition-colors`}>
                  {cat.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Grid de produtos noturno */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 px-4 pb-6 flex-1 max-w-[1200px] mx-auto w-full">
          {filtered.map(product => {
            const isUrlImg = product.image.startsWith('http') || product.image.startsWith('/');
            return (
              <div
                key={product.id}
                className="relative bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col text-left transition-all hover:border-amber-500/40 hover:shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
              >
                <button
                  onClick={() => setSelectedProduct(product)}
                  className="w-full aspect-square bg-zinc-950/60 overflow-hidden block"
                >
                  {isUrlImg ? (
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover transition-transform duration-300 hover:scale-105" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-7xl sm:text-8xl">{product.image}</span>
                  )}
                </button>
                <div className="p-3 flex flex-col gap-1">
                  <span className="font-bold text-sm sm:text-base leading-tight line-clamp-2 text-white">{product.name}</span>
                  <div className="flex items-end justify-between gap-2 mt-1">
                    <span className="text-amber-400 font-black text-base sm:text-lg tracking-tight">
                      {formatCurrency(product.price)}
                    </span>
                    <button
                      onClick={() => setSelectedProduct(product)}
                      aria-label={`Adicionar ${product.name}`}
                      className="touch-btn w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-[0_4px_14px_rgba(245,158,11,0.4)] active:scale-90 transition-transform"
                    >
                      <Plus className="w-5 h-5" strokeWidth={3} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cart */}
      {cart.length > 0 && (
        <>
          <div className="fixed bottom-0 left-0 right-0 bg-zinc-900/95 backdrop-blur border-t border-zinc-800 p-4 lg:hidden z-30">
            <button onClick={onGoToCart} className="touch-btn w-full bg-gradient-to-r from-amber-500 to-orange-600 text-zinc-950 font-bold py-4 rounded-2xl flex items-center justify-center gap-3 shadow-[0_0_18px_rgba(245,158,11,0.35)] active:scale-[0.98] transition-transform">
              <ShoppingCart className="w-5 h-5" />
              Ver Carrinho ({cart.length} {cart.length === 1 ? 'item' : 'itens'}) — {formatCurrency(cartTotal)}
            </button>
          </div>
          <div className="hidden lg:flex flex-col w-80 xl:w-96 border-l border-zinc-800 bg-zinc-950 p-4 gap-3 sticky top-0 h-screen overflow-y-auto">
            <h3 className="text-lg font-bold flex items-center gap-2 text-white">
              <ShoppingCart className="w-5 h-5 text-amber-400" /> Carrinho ({cart.length})
            </h3>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {cart.map(item => (
                <div key={item.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm">
                  <p className="font-semibold text-white">{item.quantity}x {item.product.name}</p>
                  <p className="text-amber-400 font-bold">{formatCurrency(getItemTotal(item))}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-zinc-800 pt-3 space-y-2">
              <div className="flex justify-between font-bold text-lg text-white">
                <span>Total</span>
                <span className="text-amber-400">{formatCurrency(cartTotal)}</span>
              </div>
              <button onClick={onGoToCart} className="touch-btn w-full bg-gradient-to-r from-amber-500 to-orange-600 text-zinc-950 font-bold py-4 rounded-2xl flex items-center justify-center gap-3 shadow-[0_0_18px_rgba(245,158,11,0.35)] active:scale-[0.98] transition-transform">
                Finalizar Pedido
              </button>
            </div>
          </div>
        </>
      )}


      {selectedProduct && (
        <ProductModal product={selectedProduct} onAdd={handleAddItem} onClose={() => setSelectedProduct(null)} />
      )}
      {showUpsell && (
        <UpsellPopup onAccept={handleUpsellAccept} onDecline={handleUpsellDecline} />
      )}
    </div>
  );
};

export default MenuScreen;
