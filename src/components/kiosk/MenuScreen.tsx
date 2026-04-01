import { useState } from 'react';
import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { getProducts, getSettings, getItemTotal, CartItem, Product } from '@/data/store';
import ProductModal from './ProductModal';
import UpsellPopup from './UpsellPopup';
import { formatCurrency } from '@/data/store';

interface MenuScreenProps {
  cart: CartItem[];
  onAddToCart: (item: CartItem) => void;
  onGoToCart: () => void;
  onBack: () => void;
}

const CATEGORIES = [
  { key: 'hamburgueres' as const, label: '🍔 Hambúrgueres' },
  { key: 'pizzas' as const, label: '🍕 Pizzas' },
  { key: 'bebidas' as const, label: '🥤 Bebidas' },
];

const MenuScreen = ({ cart, onAddToCart, onGoToCart, onBack }: MenuScreenProps) => {
  const [activeCategory, setActiveCategory] = useState<'hamburgueres' | 'pizzas' | 'bebidas'>('hamburgueres');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showUpsell, setShowUpsell] = useState(false);
  const [pendingItem, setPendingItem] = useState<CartItem | null>(null);
  const products = getProducts();

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
      const { combo } = getSettings();
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

      {/* Products Grid — 1col mobile, 2col tablet/totem, 3-4col desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4 flex-1 max-w-[1200px] mx-auto w-full">
        {filtered.map(product => {
          const isUrl = product.image.startsWith('http') || product.image.startsWith('/');
          return (
            <button
              key={product.id}
              onClick={() => setSelectedProduct(product)}
              className="kiosk-card flex flex-row sm:flex-col items-center p-4 gap-4 sm:gap-3 active:scale-95"
            >
              {isUrl ? (
                <img src={product.image} alt={product.name} className="w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24 object-cover rounded-xl flex-shrink-0" />
              ) : (
                <span className="text-5xl flex-shrink-0">{product.image}</span>
              )}
              <div className="flex flex-col sm:items-center gap-1 min-w-0">
                <span className="font-bold text-sm sm:text-center leading-tight">{product.name}</span>
                <span className="text-primary font-black text-lg">{formatCurrency(product.price)}</span>
              </div>
            </button>
          );
        })}
      </div>

      </div>{/* end main content */}

      {/* Cart — fixed bottom bar on mobile, sidebar on desktop */}
      {cart.length > 0 && (
        <>
          {/* Mobile/Tablet: fixed bottom bar */}
          <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4 lg:hidden z-30">
            <button
              onClick={onGoToCart}
              className="touch-btn w-full bg-primary text-primary-foreground py-4 rounded-xl flex items-center justify-center gap-3"
            >
              <ShoppingCart className="w-5 h-5" />
              Ver Carrinho ({cart.length} itens) — {formatCurrency(cartTotal)}
            </button>
          </div>

          {/* Desktop: sidebar */}
          <div className="hidden lg:flex flex-col w-80 xl:w-96 border-l border-border bg-card p-4 gap-3 sticky top-0 h-screen overflow-y-auto">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" />
              Carrinho ({cart.length})
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
              <button
                onClick={onGoToCart}
                className="touch-btn w-full bg-primary text-primary-foreground py-4 rounded-xl flex items-center justify-center gap-3"
              >
                Finalizar Pedido
              </button>
            </div>
          </div>
        </>
      )}

      {/* Product Modal */}
      {selectedProduct && (
        <ProductModal
          product={selectedProduct}
          onAdd={handleAddItem}
          onClose={() => setSelectedProduct(null)}
        />
      )}

      {/* Upsell */}
      {showUpsell && (
        <UpsellPopup onAccept={handleUpsellAccept} onDecline={handleUpsellDecline} />
      )}
    </div>
  );
};

export default MenuScreen;
