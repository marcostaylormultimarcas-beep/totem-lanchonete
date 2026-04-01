import { useState } from 'react';
import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { getProducts, getSettings, CartItem, Product } from '@/data/store';
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

      {/* Products Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 flex-1">
        {filtered.map(product => {
          const isUrl = product.image.startsWith('http') || product.image.startsWith('/');
          return (
            <button
              key={product.id}
              onClick={() => setSelectedProduct(product)}
              className="kiosk-card flex flex-col items-center p-4 gap-3 active:scale-95"
            >
              {isUrl ? (
                <img src={product.image} alt={product.name} className="w-16 h-16 object-cover rounded-xl" />
              ) : (
                <span className="text-5xl">{product.image}</span>
              )}
              <span className="font-bold text-sm text-center leading-tight">{product.name}</span>
              <span className="text-primary font-black text-lg">{formatCurrency(product.price)}</span>
            </button>
          );
        })}
      </div>

      {/* Cart Footer */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4">
          <button
            onClick={onGoToCart}
            className="touch-btn w-full bg-primary text-primary-foreground py-4 rounded-xl flex items-center justify-center gap-3"
          >
            <ShoppingCart className="w-5 h-5" />
            Ver Carrinho ({cart.length} itens) — {formatCurrency(cartTotal)}
          </button>
        </div>
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
