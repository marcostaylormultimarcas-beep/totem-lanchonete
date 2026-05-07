import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Plus, ChevronRight, ShoppingCart, User, ClipboardList } from 'lucide-react';
import { formatCurrency, Product, CartItem, BannerItem } from '@/data/store';
import { supabase } from '@/integrations/supabase/client';
import ProductModal from './ProductModal';

interface StartScreenProps {
  onStart: () => void;
  onAddToCart?: (item: CartItem) => void;
  onGoToCart?: () => void;
  cartCount?: number;
}

const DEFAULT_CATEGORY_ICONS = { hamburgueres: '🍔', pizzas: '🍕', bebidas: '🥤' };
const CATEGORIES = [
  { key: 'hamburgueres' as const, label: 'Hambúrgueres' },
  { key: 'pizzas' as const, label: 'Pizzas' },
  { key: 'bebidas' as const, label: 'Bebidas' },
];

const StartScreen = ({ onStart, onAddToCart, onGoToCart, cartCount = 0 }: StartScreenProps) => {
  const [storeName, setStoreName] = useState('Vision Mídia');
  const [categoryIcons, setCategoryIcons] = useState<Record<string, string>>(DEFAULT_CATEGORY_ICONS);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeBanner, setActiveBanner] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch settings from Supabase
  useEffect(() => {
    const fetchSettings = async () => {
      const { data } = await supabase.from('settings').select('*').limit(1).maybeSingle();
      if (data) {
        setStoreName(data.store_name || 'Vision Mídia');
        setBanners((data.banners as unknown as BannerItem[]) || []);
        if ((data as any).category_icons) setCategoryIcons({ ...DEFAULT_CATEGORY_ICONS, ...((data as any).category_icons as any) });
      }
    };
    fetchSettings();
  }, []);

  // Fetch products from Supabase
  useEffect(() => {
    const fetchProducts = async () => {
      const { data } = await supabase.from('products').select('*');
      if (data) {
        const mapped: Product[] = data.map((p: any) => ({
          id: p.id,
          name: p.name,
          price: Number(p.price),
          category: p.category as Product['category'],
          image: p.image,
          removableIngredients: (p.removable_ingredients as string[]) || [],
          extras: (p.extras as { name: string; price: number }[]) || [],
          isCombo: p.is_combo || false,
        }));
        setProducts(mapped);
      }
      setLoading(false);
    };
    fetchProducts();
  }, []);

  // Realtime subscription for settings changes
  useEffect(() => {
    const channel = supabase
      .channel('settings-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, (payload: any) => {
        const data = payload.new;
        if (data) {
          setStoreName(data.store_name || 'Vision Mídia');
          setBanners((data.banners as unknown as BannerItem[]) || []);
          if (data.category_icons) setCategoryIcons({ ...DEFAULT_CATEGORY_ICONS, ...data.category_icons });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Realtime subscription for products changes
  useEffect(() => {
    const channel = supabase
      .channel('products-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        // Re-fetch all products on any change
        supabase.from('products').select('*').then(({ data }) => {
          if (data) {
            const mapped: Product[] = data.map((p: any) => ({
              id: p.id,
              name: p.name,
              price: Number(p.price),
              category: p.category as Product['category'],
              image: p.image,
              removableIngredients: (p.removable_ingredients as string[]) || [],
              extras: (p.extras as { name: string; price: number }[]) || [],
              isCombo: p.is_combo || false,
            }));
            setProducts(mapped);
          }
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <h1 className="text-xl font-black tracking-tight">
          <span className="text-primary">{storeName.split(' ')[0]}</span>{' '}
          <span className="text-foreground">{storeName.split(' ').slice(1).join(' ')}</span>
        </h1>
        <div className="flex items-center gap-2">
          <Link to="/meus-pedidos" className="p-2 rounded-full bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Meus Pedidos">
            <ClipboardList className="w-5 h-5" />
          </Link>
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
          <div className="relative overflow-hidden rounded-2xl h-40 sm:h-48 md:h-56">
            {banners.map((banner, i) => (
              <div key={banner.id}
                className={`absolute inset-0 transition-all duration-700 ease-in-out ${
                  i === activeBanner ? 'opacity-100 translate-x-0' : i < activeBanner ? 'opacity-0 -translate-x-full' : 'opacity-0 translate-x-full'
                }`}>
                {isUrl(banner.image) ? (
                  <img src={banner.image} alt={banner.title || 'Banner'} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-6xl"
                    style={{
                      background: 'linear-gradient(135deg, hsl(25 95% 53% / 0.9), hsl(0 72% 51% / 0.8))',
                    }}>
                    {banner.image}
                  </div>
                )}
              </div>
            ))}
            {banners.length > 1 && (
              <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 z-20">
                {banners.map((_, i) => (
                  <button key={i} onClick={() => setActiveBanner(i)}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${i === activeBanner ? 'bg-white w-5 shadow-md' : 'bg-white/50'}`} />
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
          {CATEGORIES.map(cat => {
            const icon = categoryIcons[cat.key] || '';
            return (
              <button key={cat.key} onClick={onStart} className="flex flex-col items-center gap-2 group">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-muted border-2 border-border group-hover:border-primary flex items-center justify-center text-3xl sm:text-4xl transition-all duration-200 group-active:scale-90 overflow-hidden">
                  {isUrl(icon) ? (
                    <img src={icon} alt={cat.label} className="w-full h-full object-cover" />
                  ) : (
                    <span>{icon}</span>
                  )}
                </div>
                <span className="text-xs font-semibold text-muted-foreground group-hover:text-foreground transition-colors">{cat.label}</span>
              </button>
            );
          })}
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {topProducts.map(product => (
            <div key={product.id} className="kiosk-card group relative overflow-hidden">
              <button onClick={() => setSelectedProduct(product)} className="w-full flex flex-col items-stretch text-left">
                <div className="w-full aspect-square bg-muted overflow-hidden">
                  {isUrl(product.image) ? (
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
              <button onClick={(e) => { e.stopPropagation(); handleQuickAdd(product); }}
                className="absolute top-2 right-2 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg active:scale-90"
                title="Adicionar rápido">
                <Plus className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
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
