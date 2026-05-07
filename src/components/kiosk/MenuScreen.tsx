import { useState, useEffect } from 'react';
import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { getItemTotal, CartItem, Product } from '@/data/store';
import { supabase } from '@/integrations/supabase/client';
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

const CATEGORIES = [
  { key: 'hamburgueres' as const, label: '🍔 Hambúrgueres' },
  { key: 'pizzas' as const, label: '🍕 Pizzas' },
  { key: 'bebidas' as const, label: '🥤 Bebidas' },
];

const MenuScreen = ({ cart, onAddToCart, onGoToCart, onBack, initialProduct, onInitialProductHandled }: MenuScreenProps) => {
  const [activeCategory, setActiveCategory] = useState<'hamburgueres' | 'pizzas' | 'bebidas'>('hamburgueres');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showUpsell, setShowUpsell] = useState(false);
  const [pendingItem, setPendingItem] = useState<CartItem | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [combo, setCombo] = useState({ name: 'Batata + Refri', description: 'Batata + Refri', price: 15, emoji: '🍟🥤' });

  useEffect(() => {
    const fetchData = async () => {
      const [{ data: prods }, { data: settingsData }] = await Promise.all([
        supabase.from('products').select('*'),
        supabase.from('settings').select('combo').limit(1).maybeSingle(),
      ]);
      if (prods) {
        setProducts(prods.map((p: any) => ({
          id: p.id, name: p.name, price: Number(p.price), category: p.category as Product['category'],
          image: p.image, removableIngredients: (p.removable_ingredients as string[]) || [],
          extras: (p.extras as { name: string; price: number }[]) || [], isCombo: p.is_combo || false,
        })));
      }
      if (settingsData?.combo) setCombo(settingsData.combo as any);
    };
    fetchData();
  }, []);

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
          image: combo.emoji,
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

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Main content area */}
      <div className="flex-1 flex flex-col pb-24 lg:pb-0">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-7 h-7" />
        </button>
        <h2 className="text-xl font-bold">Cardápio</h2>
        <button onClick={onGoToCart} className="relative text-primary">
          <ShoppingCart className="w-7 h-7" />
          {cart.length > 0 && (
            <span className="absolute -top-2 -right-2 bg-secondary text-secondary-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {cart.length}
            </span>
          )}
        </button>
      </div>

      {/* Categories */}
      <div className="flex gap-2 p-4 overflow-x-auto">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={`touch-btn px-6 py-3 rounded-xl whitespace-nowrap text-base font-semibold transition-all ${
              activeCategory === cat.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4 flex-1 max-w-[1200px] mx-auto w-full">
        {filtered.map(product => {
          const isUrl = product.image.startsWith('http') || product.image.startsWith('/');
          return (
            <button
              key={product.id}
              onClick={() => setSelectedProduct(product)}
              className="kiosk-card overflow-hidden flex flex-col text-left active:scale-95 transition-transform group"
            >
              <div className="w-full aspect-square bg-muted overflow-hidden">
                {isUrl ? (
                  <img src={product.image} alt={product.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-7xl sm:text-8xl">{product.image}</span>
                )}
              </div>
              <div className="p-3 flex flex-col gap-1">
                <span className="font-bold text-sm sm:text-base leading-tight line-clamp-2">{product.name}</span>
                <span className="text-primary font-black text-base sm:text-lg">{formatCurrency(product.price)}</span>
              </div>
            </button>
          );
        })}
      </div>

      </div>

      {/* Cart */}
      {cart.length > 0 && (
        <>
          <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4 lg:hidden z-30">
            <button onClick={onGoToCart} className="touch-btn w-full bg-primary text-primary-foreground py-4 rounded-xl flex items-center justify-center gap-3">
              <ShoppingCart className="w-5 h-5" />
              Ver Carrinho ({cart.length} itens) — {formatCurrency(cartTotal)}
            </button>
          </div>
          <div className="hidden lg:flex flex-col w-80 xl:w-96 border-l border-border bg-card p-4 gap-3 sticky top-0 h-screen overflow-y-auto">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" /> Carrinho ({cart.length})
            </h3>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {cart.map(item => (
                <div key={item.id} className="bg-muted rounded-xl p-3 text-sm">
                  <p className="font-semibold">{item.quantity}x {item.product.name}</p>
                  <p className="text-primary font-bold">{formatCurrency(getItemTotal(item))}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-border pt-3 space-y-2">
              <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span className="text-primary">{formatCurrency(cartTotal)}</span>
              </div>
              <button onClick={onGoToCart} className="touch-btn w-full bg-primary text-primary-foreground py-4 rounded-xl flex items-center justify-center gap-3">
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
