import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Plus, ChevronRight, ShoppingCart, ClipboardList, Instagram, MessageCircle, Sparkles, Search, SlidersHorizontal, MapPin, Bell, Star, Clock, Heart, Home, User, Crown } from 'lucide-react';
import { formatCurrency, Product, CartItem, BannerItem, CategoryItem } from '@/data/store';
import { supabase } from '@/integrations/supabase/client';
import { useOrgId } from '@/contexts/OrgContext';
import ProductModal from './ProductModal';

interface StartScreenProps {
  onStart: () => void;
  onAddToCart?: (item: CartItem) => void;
  onGoToCart?: () => void;
  onSelectProduct?: (product: Product) => void;
  cartCount?: number;
}

const DEFAULT_CATEGORIES: CategoryItem[] = [
  { key: 'hamburgueres', label: 'Hambúrgueres', icon: '🍔' },
  { key: 'pizzas', label: 'Pizzas', icon: '🍕' },
  { key: 'bebidas', label: 'Bebidas', icon: '🥤' },
];

const StartScreen = ({ onStart, onAddToCart, onGoToCart, onSelectProduct, cartCount = 0 }: StartScreenProps) => {
  const orgId = useOrgId();
  const [storeName, setStoreName] = useState('VisionFood');
  const [categories, setCategories] = useState<CategoryItem[]>(DEFAULT_CATEGORIES);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeBanner, setActiveBanner] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [instagramUrl, setInstagramUrl] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');

  useEffect(() => {
    if (!orgId) return;
    const fetchSettings = async () => {
      const { data } = await supabase.from('settings').select('*').eq('organization_id', orgId).maybeSingle();
      if (data) {
        setStoreName(data.store_name || 'VisionFood');
        setBanners((data.banners as unknown as BannerItem[]) || []);
        setInstagramUrl((data as any).instagram_url || '');
        setWhatsappNumber(data.whatsapp_number || '');
        const cats = (data as any).categories as CategoryItem[] | undefined;
        if (cats && cats.length > 0) setCategories(cats);
        else if ((data as any).category_icons) {
          const icons = (data as any).category_icons as Record<string, string>;
          setCategories(DEFAULT_CATEGORIES.map(c => ({ ...c, icon: icons[c.key] || c.icon })));
        }
      }
    };
    fetchSettings();
  }, [orgId]);

  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    const fetchProducts = async () => {
      const { data } = await supabase.from('products').select('*').eq('organization_id', orgId);
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
          ingredients: (p.ingredients as string[]) || [],
          description: p.description || '',
          prepTimeMin: Number((p as any).prep_time_min ?? 0),
        }));
        setProducts(mapped);
      }
      setLoading(false);
    };
    fetchProducts();
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel('settings-changes-' + orgId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `organization_id=eq.${orgId}` }, (payload: any) => {
        const data = payload.new;
        if (data) {
          setStoreName(data.store_name || 'VisionFood');
          setBanners((data.banners as unknown as BannerItem[]) || []);
          setInstagramUrl(data.instagram_url || '');
          setWhatsappNumber(data.whatsapp_number || '');
          const cats = data.categories as CategoryItem[] | undefined;
          if (cats && cats.length > 0) setCategories(cats);
          else if (data.category_icons) {
            const icons = data.category_icons as Record<string, string>;
            setCategories(DEFAULT_CATEGORIES.map(c => ({ ...c, icon: icons[c.key] || c.icon })));
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel('products-changes-' + orgId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `organization_id=eq.${orgId}` }, () => {
        supabase.from('products').select('*').eq('organization_id', orgId).then(({ data }) => {
          if (data) {
            const mapped: Product[] = data.map((p: any) => ({
              id: p.id, name: p.name, price: Number(p.price),
              category: p.category as Product['category'], image: p.image,
              removableIngredients: (p.removable_ingredients as string[]) || [],
              extras: (p.extras as { name: string; price: number }[]) || [],
              isCombo: p.is_combo || false,
              ingredients: (p.ingredients as string[]) || [],
              description: p.description || '',
            }));
            setProducts(mapped);
          }
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  const topProducts = products.slice(0, 6);

  useEffect(() => {
    if (banners.length <= 1) return;
    const interval = setInterval(() => {
      setActiveBanner(prev => (prev + 1) % banners.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [banners.length]);

  const handleQuickAdd = (product: Product) => {
    if (onSelectProduct) { onSelectProduct(product); return; }
    if (onAddToCart) {
      const item: CartItem = { id: crypto.randomUUID(), product, quantity: 1, removedIngredients: [], selectedExtras: [] };
      onAddToCart(item);
    } else {
      setSelectedProduct(product);
    }
  };

  const isUrl = (str: string) => typeof str === 'string' && (str.startsWith('http') || str.startsWith('/'));
  const brandFirst = storeName.split(' ')[0] || storeName;
  const brandRest = storeName.split(' ').slice(1).join(' ');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0B0B0D' }}>
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-[#FF7A00] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-zinc-500 text-sm font-[Inter]">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: '#0B0B0D', fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif", color: '#fafafa' }}>
      <style>{`
        .vf-card { background:#18181B; border:1px solid rgba(255,255,255,0.04); box-shadow: 0 8px 24px -12px rgba(0,0,0,0.6); }
        .vf-chip { background:#18181B; border:1px solid rgba(255,255,255,0.05); }
        .vf-fade-in { animation: vfFadeIn .4s ease both; }
        @keyframes vfFadeIn { from { opacity:0; transform: translateY(6px);} to{opacity:1; transform:none;} }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { scrollbar-width: none; }
        .vf-card img, .vf-banner img { filter:none !important; mix-blend-mode:normal !important; }
      `}</style>

      {/* Header */}
      <header className="px-5 pt-6 pb-3 flex items-center justify-between vf-fade-in">
        <h1 className="text-2xl font-extrabold tracking-tight">
          <span style={{ color: '#FF7A00' }}>{brandFirst}</span>
          <span className="text-white">{brandRest}</span>
        </h1>
        <div className="flex items-center gap-2">
          <Link to="/clube" className="w-10 h-10 rounded-full vf-chip flex items-center justify-center text-[#FF7A00] hover:bg-[#FF7A00]/10 transition" title="Clube">
            <Sparkles className="w-[18px] h-[18px]" />
          </Link>
          <Link to="/meus-pedidos" className="relative w-10 h-10 rounded-full vf-chip flex items-center justify-center text-zinc-300 hover:text-white transition" title="Meus Pedidos">
            <ClipboardList className="w-[18px] h-[18px]" />
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#FF7A00] text-white rounded-full text-[10px] font-bold flex items-center justify-center">{cartCount}</span>
            )}
          </Link>
          <button onClick={onGoToCart || onStart} className="relative w-10 h-10 rounded-full vf-chip flex items-center justify-center text-zinc-300 hover:text-white transition" title="Notificações">
            <Bell className="w-[18px] h-[18px]" />
          </button>
        </div>
      </header>

      {/* Address pill */}
      <div className="px-5 mt-2 vf-fade-in">
        <button onClick={onStart} className="w-full vf-chip rounded-2xl px-4 py-3 flex items-center gap-3 hover:border-[#FF7A00]/40 transition">
          <div className="w-9 h-9 rounded-full bg-[#FF7A00]/10 flex items-center justify-center text-[#FF7A00]">
            <MapPin className="w-[18px] h-[18px]" />
          </div>
          <div className="flex-1 text-left">
            <div className="text-[11px] text-zinc-500 leading-none">Entregar em</div>
            <div className="text-sm font-semibold text-white mt-1 truncate">Selecionar endereço</div>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        </button>
      </div>

      {/* Search */}
      <div className="px-5 mt-3 vf-fade-in">
        <button onClick={onStart} className="w-full vf-chip rounded-2xl px-4 py-3 flex items-center gap-3 hover:border-[#FF7A00]/40 transition">
          <Search className="w-[18px] h-[18px] text-zinc-400" />
          <span className="flex-1 text-left text-sm text-zinc-500">Buscar pratos, bebidas e mais…</span>
          <SlidersHorizontal className="w-[18px] h-[18px] text-zinc-400" />
        </button>
      </div>

      {/* Banner */}
      {banners.length > 0 && (
        <div className="px-5 mt-5 vf-fade-in">
          <div className="vf-banner relative overflow-hidden rounded-3xl h-44 sm:h-52" style={{ borderRadius: 24 }}>
            {banners.map((banner, i) => (
              <div key={banner.id} className={`absolute inset-0 transition-opacity duration-700 ${i === activeBanner ? 'opacity-100' : 'opacity-0'}`}>
                {isUrl(banner.image) ? (
                  <img src={banner.image} alt={banner.title || 'Banner'} className="w-full h-full object-cover" style={{ colorScheme: 'light' } as React.CSSProperties} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-7xl" style={{ background: 'linear-gradient(135deg, #FF7A00, #B23A00)' }}>{banner.image}</div>
                )}
              </div>
            ))}
            {banners.length > 1 && (
              <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 z-10">
                {banners.map((_, i) => (
                  <button key={i} onClick={() => setActiveBanner(i)} aria-label={`Banner ${i+1}`}
                    className={`h-[6px] rounded-full transition-all duration-300 ${i === activeBanner ? 'w-6 bg-[#FF7A00]' : 'w-[6px] bg-white/40'}`} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Categories */}
      <section className="mt-7 vf-fade-in">
        <div className="px-5 flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Categorias</h2>
          <button onClick={onStart} className="text-[#FF7A00] text-sm font-semibold flex items-center gap-0.5 hover:underline">
            Ver todas <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-5 overflow-x-auto px-5 pb-2 hide-scrollbar">
          {categories.map(cat => {
            const active = activeCategory === cat.key;
            const icon = cat.icon || '';
            return (
              <button key={cat.key} onClick={() => { setActiveCategory(cat.key); onStart(); }} className="flex flex-col items-center gap-2 flex-shrink-0 group">
                <div className={`w-[68px] h-[68px] rounded-full flex items-center justify-center text-3xl transition-all duration-200 overflow-hidden ${active ? 'border-2 border-[#FF7A00] bg-[#FF7A00]/10 shadow-[0_0_20px_rgba(255,122,0,0.35)]' : 'vf-chip group-hover:border-[#FF7A00]/40'}`}>
                  {isUrl(icon) ? (
                    <img src={icon} alt={cat.label} className="w-full h-full object-cover" />
                  ) : (
                    <span>{icon}</span>
                  )}
                </div>
                <span className={`text-[12px] font-semibold transition-colors max-w-[80px] truncate ${active ? 'text-[#FF7A00]' : 'text-zinc-400 group-hover:text-white'}`}>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Mais pedidos */}
      <section className="mt-7 vf-fade-in">
        <div className="px-5 flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Mais pedidos</h2>
          <button onClick={onStart} className="text-[#FF7A00] text-sm font-semibold flex items-center gap-0.5 hover:underline">
            Ver tudo <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-4 overflow-x-auto px-5 pb-2 hide-scrollbar snap-x snap-mandatory">
          {topProducts.map((product, idx) => (
            <article key={product.id} className="vf-card relative flex-shrink-0 snap-start overflow-hidden flex flex-col" style={{ borderRadius: 20, width: 230 }}>
              <button onClick={() => onSelectProduct ? onSelectProduct(product) : setSelectedProduct(product)} className="text-left">
                <div className="relative w-full h-[180px] bg-zinc-900 overflow-hidden">
                  {isUrl(product.image) ? (
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover transition-transform duration-500 hover:scale-105" style={{ colorScheme: 'light' } as React.CSSProperties} />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-7xl">{product.image}</span>
                  )}
                  {idx === 0 && (
                    <span className="absolute top-3 left-3 bg-[#FF7A00] text-white text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">🔥 Mais pedido</span>
                  )}
                  <button onClick={(e) => e.preventDefault()} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white hover:bg-black/60 transition">
                    <Heart className="w-[14px] h-[14px]" />
                  </button>
                </div>
                <div className="p-4 pb-3">
                  <h3 className="font-bold text-[15px] text-white leading-tight line-clamp-1">{product.name}</h3>
                  <p className="text-[12px] text-zinc-500 mt-1 line-clamp-2 leading-snug min-h-[32px]">{product.description || 'Feito na hora, com ingredientes selecionados.'}</p>
                  <div className="flex items-center gap-3 mt-2.5 text-[11px] text-zinc-400">
                    <span className="flex items-center gap-1"><Star className="w-3 h-3 fill-[#FF7A00] text-[#FF7A00]" /> <span className="text-white font-semibold">4,8</span></span>
                    <span className="w-px h-3 bg-zinc-700" />
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> 30–40 min</span>
                  </div>
                </div>
              </button>
              <div className="px-4 pb-4 flex items-center justify-between">
                <span className="text-[#FF7A00] font-extrabold text-lg">{formatCurrency(product.price)}</span>
                <button onClick={(e) => { e.stopPropagation(); handleQuickAdd(product); }}
                  className="w-10 h-10 rounded-full bg-[#FF7A00] text-white flex items-center justify-center shadow-[0_6px_20px_rgba(255,122,0,0.45)] active:scale-90 hover:brightness-110 transition"
                  title="Adicionar">
                  <Plus className="w-5 h-5" strokeWidth={2.5} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Promo card */}
      <div className="px-5 mt-7 vf-fade-in">
        <button onClick={onStart} className="w-full vf-chip rounded-2xl px-4 py-4 flex items-center gap-4 hover:border-[#FF7A00]/40 transition">
          <div className="w-11 h-11 rounded-full bg-[#FF7A00]/10 flex items-center justify-center text-[#FF7A00]">
            <Crown className="w-5 h-5" />
          </div>
          <div className="flex-1 text-left">
            <div className="font-bold text-white text-sm">Frete Grátis</div>
            <div className="text-[12px] text-zinc-400">Em pedidos acima de <span className="text-[#FF7A00] font-semibold">R$ 40,00</span></div>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        </button>
      </div>

      {/* Social/footer */}
      {(instagramUrl || whatsappNumber) && (
        <div className="mt-8 flex justify-center gap-3 px-5">
          {instagramUrl && (
            <a href={instagramUrl} target="_blank" rel="noopener noreferrer"
              className="w-11 h-11 rounded-full bg-gradient-to-br from-pink-500 via-red-500 to-yellow-500 flex items-center justify-center text-white shadow-lg active:scale-95 transition" aria-label="Instagram">
              <Instagram className="w-5 h-5" />
            </a>
          )}
          {whatsappNumber && (
            <a href={`https://wa.me/${whatsappNumber.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
              className="w-11 h-11 rounded-full bg-[#25D366] flex items-center justify-center text-white shadow-lg active:scale-95 transition" aria-label="WhatsApp">
              <MessageCircle className="w-5 h-5" />
            </a>
          )}
        </div>
      )}

      <div className="mt-6 text-center text-[11px] text-zinc-600">
        © {new Date().getFullYear()} {storeName} · by VisionTek
        <div className="mt-2">
          <Link to="/admin" className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300">
            <Settings className="w-3 h-3" /> Painel
          </Link>
        </div>
      </div>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 inset-x-0 z-40 px-3 pb-3 pt-2" style={{ background: 'linear-gradient(180deg, rgba(11,11,13,0) 0%, #0B0B0D 35%)' }}>
        <div className="vf-chip rounded-2xl flex items-center justify-around px-2 py-2 max-w-md mx-auto backdrop-blur" style={{ background: 'rgba(24,24,27,0.92)' }}>
          {[
            { icon: Home, label: 'Início', active: true, onClick: () => {} },
            { icon: Search, label: 'Buscar', onClick: onStart },
            { icon: ClipboardList, label: 'Pedidos', to: '/meus-pedidos' },
            { icon: Heart, label: 'Favoritos', onClick: onStart },
            { icon: User, label: 'Perfil', to: '/meus-pedidos' },
          ].map((item, i) => {
            const Icon = item.icon;
            const inner = (
              <div className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all ${item.active ? 'bg-[#FF7A00]/10 text-[#FF7A00]' : 'text-zinc-400 hover:text-white'}`}>
                <Icon className="w-[20px] h-[20px]" strokeWidth={item.active ? 2.4 : 2} />
                <span className="text-[10px] font-semibold">{item.label}</span>
              </div>
            );
            return item.to ? (
              <Link key={i} to={item.to}>{inner}</Link>
            ) : (
              <button key={i} onClick={item.onClick}>{inner}</button>
            );
          })}
        </div>
      </nav>

      {selectedProduct && (
        <ProductModal product={selectedProduct}
          onAdd={(item) => { if (onAddToCart) onAddToCart(item); setSelectedProduct(null); }}
          onClose={() => setSelectedProduct(null)} />
      )}
    </div>
  );
};

export default StartScreen;
