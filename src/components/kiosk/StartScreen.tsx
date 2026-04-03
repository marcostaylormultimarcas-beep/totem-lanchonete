import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Plus, ChevronRight, ShoppingCart } from 'lucide-react';
import { getSettings, getProducts, formatCurrency, Product, CartItem } from '@/data/store';
import ProductModal from './ProductModal';

interface StartScreenProps {
  onStart: () => void;
  onAddToCart?: (item: CartItem) => void;
  onGoToCart?: () => void;
  cartCount?: number;
}

const CATEGORIES = [
  { key: 'hamburgueres' as const, label: 'Hambúrgueres', emoji: '🍔' },
  { key: 'pizzas' as const, label: 'Pizzas', emoji: '🍕' },
  { key: 'bebidas' as const, label: 'Bebidas', emoji: '🥤' },
];

const StartScreen = ({ onStart, onAddToCart, onGoToCart, cartCount = 0 }: StartScreenProps) => {
  const settings = getSettings();
  const products = getProducts();
  const storeName = settings.storeName || 'Vision Mídia';
  const banners = settings.banners || [];
  const [activeBanner, setActiveBanner] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const topProducts = products
    .filter(p => p.category === 'hamburgueres' || p.category === 'pizzas')
    .slice(0, 4);

  useEffect(() => {
    if (banners.length <= 1) return;
    const interval = setInterval(() => {
      setActiveBanner(prev => (prev + 1) % banners.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [banners.length]);

  const handleQuickAdd = (product: Product) => {
    if (onAddToCart) {
      const item: CartItem = {
        id: crypto.randomUUID(), product, quantity: 1,
        removedIngredients: [], selectedExtras: [],
      };
      onAddToCart(item);
    } else {
      setSelectedProduct(product);
    }
  };

  const badgeColorMap = {
    primary: 'bg-primary text-primary-foreground',
    secondary: 'bg-secondary text-secondary-foreground',
    accent: 'bg-accent text-accent-foreground',
  };

  const isUrl = (str: string) => str.startsWith('http') || str.startsWith('/');

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <h1 className="text-xl font-black tracking-tight">
          <span className="text-primary">{storeName.split(' ')[0]}</span>{' '}
          <span className="text-foreground">{storeName.split(' ').slice(1).join(' ')}</span>
        </h1>
        <div className="flex items-center gap-2">
          {cartCount > 0 && (
            <button onClick={onGoToCart || onStart} className="relative p-2 rounded-full bg-primary text-primary-foreground" title="Ver Carrinho">
              <ShoppingCart className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-secondary text-secondary-foreground rounded-full text-xs font-bold flex items-center justify-center">
                {cartCount}
              </span>
            </button>
          )}
          <Link to="/admin" className="p-2 rounded-full bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Painel Administrativo">
            <Settings className="w-5 h-5" />
          </Link>
        </div>
      </div>

      {/* Banner Carousel */}
      {banners.length > 0 && (
        <div className="px-4 mb-5">
          <div className="relative overflow-hidden rounded-2xl h-36 sm:h-44">
            {banners.map((banner, i) => (
              <div key={banner.id}
                className={`absolute inset-0 flex items-center justify-between px-5 transition-all duration-700 ease-in-out ${
                  i === activeBanner ? 'opacity-100 translate-x-0' : i < activeBanner ? 'opacity-0 -translate-x-full' : 'opacity-0 translate-x-full'
                }`}
                style={{
                  background: i % 3 === 0
                    ? 'linear-gradient(135deg, hsl(25 95% 53% / 0.9), hsl(0 72% 51% / 0.8))'
                    : i % 3 === 1
                    ? 'linear-gradient(135deg, hsl(45 93% 47% / 0.9), hsl(25 95% 53% / 0.8))'
                    : 'linear-gradient(135deg, hsl(0 72% 51% / 0.9), hsl(25 95% 53% / 0.8))',
                }}>
                <div className="flex-1 space-y-2 z-10">
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${badgeColorMap[banner.badgeColor] || badgeColorMap.primary}`}>{banner.badgeText}</span>
                  <h3 className="text-lg sm:text-xl font-black text-white leading-tight">{banner.title}</h3>
                  <p className="text-white/80 text-xs sm:text-sm leading-snug">{banner.subtitle}</p>
                </div>
                <div className="text-5xl sm:text-6xl flex-shrink-0 ml-3">
                  {isUrl(banner.image) ? (
                    <img src={banner.image} alt={banner.title} className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-xl" />
                  ) : banner.image}
                </div>
              </div>
            ))}
            {banners.length > 1 && (
              <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 z-20">
                {banners.map((_, i) => (
                  <button key={i} onClick={() => setActiveBanner(i)}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${i === activeBanner ? 'bg-white w-5' : 'bg-white/40'}`} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Categories */}
      <div className="px-4 mb-6">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">Categorias</h2>
        <div className="flex gap-4 justify-center">
          {CATEGORIES.map(cat => (
            <button key={cat.key} onClick={onStart} className="flex flex-col items-center gap-2 group">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-muted border-2 border-border group-hover:border-primary flex items-center justify-center text-3xl sm:text-4xl transition-all duration-200 group-active:scale-90">
                {cat.emoji}
              </div>
              <span className="text-xs font-semibold text-muted-foreground group-hover:text-foreground transition-colors">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Most Ordered */}
      <div className="px-4 flex-1 pb-28">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">🔥 Mais Pedidos</h2>
          <button onClick={onStart} className="text-primary text-xs font-bold flex items-center gap-0.5 hover:underline">
            Ver tudo <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {topProducts.map(product => (
            <div key={product.id} className="kiosk-card group relative">
              <button onClick={() => setSelectedProduct(product)} className="w-full flex flex-col items-center p-3 sm:p-4 gap-2 text-center">
                {isUrl(product.image) ? (
                  <img src={product.image} alt={product.name} className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-xl" />
                ) : (
                  <span className="text-4xl sm:text-5xl">{product.image}</span>
                )}
                <span className="font-bold text-xs sm:text-sm leading-tight line-clamp-2">{product.name}</span>
                <span className="text-primary font-black text-sm sm:text-base">{formatCurrency(product.price)}</span>
              </button>
              <button onClick={(e) => { e.stopPropagation(); handleQuickAdd(product); }}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 active:scale-90 sm:opacity-100"
                title="Adicionar rápido">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background via-background to-transparent z-30">
        <button onClick={onStart} className="touch-btn w-full bg-primary text-primary-foreground py-5 text-xl font-black rounded-2xl pulse-glow relative">
          FAZER PEDIDO
          {cartCount > 0 && (
            <span className="absolute top-2 right-4 bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full text-xs font-bold">
              {cartCount} item{cartCount > 1 ? 's' : ''}
            </span>
          )}
        </button>
      </div>

      {/* Product Modal */}
      {selectedProduct && (
        <ProductModal product={selectedProduct}
          onAdd={(item) => { if (onAddToCart) onAddToCart(item); setSelectedProduct(null); }}
          onClose={() => setSelectedProduct(null)} />
      )}
    </div>
  );
};

export default StartScreen;
