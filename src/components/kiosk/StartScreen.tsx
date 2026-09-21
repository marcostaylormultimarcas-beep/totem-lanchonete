import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Plus, ChevronRight, ShoppingCart, ClipboardList, Instagram, MessageCircle, Sparkles, Search, SlidersHorizontal, MapPin, Bell, Star, Clock, Heart, Home, User, Crown } from 'lucide-react';
import { formatCurrency, Product, CartItem, BannerItem, CategoryItem } from '@/data/store';
import { fetchPublicStorefrontConfig } from '@/lib/publicStorefrontConfig';
import { fetchPublicCatalog } from '@/lib/publicCatalog';
import { useOrgId } from '@/contexts/OrgContext';
import ProductModal from './ProductModal';

interface StartScreenProps {
  onStart: () => void;
  onAddToCart?: (item: CartItem) => void;
  onGoToCart?: () => void;
  onSelectProduct?: (product: Product) => void;
  cartCount?: number;
  deviceOwnedKiosk?: boolean;
}

const DEFAULT_CATEGORIES: CategoryItem[] = [
  { key: 'hamburgueres', label: 'Hambúrgueres', icon: '🍔' },
  { key: 'pizzas', label: 'Pizzas', icon: '🍕' },
  { key: 'bebidas', label: 'Bebidas', icon: '🥤' },
];

const StartScreen = ({ onStart, onAddToCart, onGoToCart, onSelectProduct, cartCount = 0, deviceOwnedKiosk = false }: StartScreenProps) => {
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
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('vf_favoritos') || '[]'); } catch { return []; }
  });
  const [showFavorites, setShowFavorites] = useState(false);
  const bannerTouchStartX = useRef<number | null>(null);
  const suppressBannerClick = useRef(false);

  const toggleFavorite = (id: string) => {
    setFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id];
      try { localStorage.setItem('vf_favoritos', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    const fetchSettings = async () => {
      try {
        const data = await fetchPublicStorefrontConfig(orgId);
        if (cancelled) return;
        setStoreName(data.store_name || 'VisionFood');
        setBanners((data.banners as BannerItem[]) || []);
        setInstagramUrl(data.instagram_url || '');
        setWhatsappNumber(data.whatsapp_number || '');
        const cats = data.categories as CategoryItem[] | undefined;
        if (cats && cats.length > 0) setCategories(cats);
        else if (data.category_icons) {
          const icons = data.category_icons as Record<string, string>;
          setCategories(DEFAULT_CATEGORIES.map(c => ({ ...c, icon: icons[c.key] || c.icon })));
        }
      } catch (error) {
        if (!cancelled) console.warn('[StartScreen] storefront config error:', error);
      }
    };
    fetchSettings();
    const pollId = window.setInterval(fetchSettings, 30000);
    return () => { cancelled = true; window.clearInterval(pollId); };
  }, [orgId]);

  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    let cancelled = false;

    const fetchProducts = async () => {
      try {
        const data = await fetchPublicCatalog(orgId);
        if (cancelled) return;
        const mapped: Product[] = data.map((p) => ({
          id: p.id,
          name: p.name,
          price: Number(p.price),
          category: p.category as Product['category'],
          image: p.image || '',
          removableIngredients: p.removable_ingredients || [],
          extras: p.extras || [],
          isCombo: p.is_combo || false,
          ingredients: p.ingredients || [],
          description: p.description || '',
          prepTimeMin: Number(p.prep_time_min ?? 0),
        }));
        setProducts(mapped.filter((product) => !product.isCombo));
      } catch (error) {
        if (!cancelled) console.warn('[StartScreen] public catalog error:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchProducts();
    const pollId = window.setInterval(fetchProducts, 30000);
    return () => { cancelled = true; window.clearInterval(pollId); };
  }, [orgId]);

  const displayedProducts = showFavorites
    ? products.filter((product) => favorites.includes(product.id))
    : products.slice(0, 6);

  useEffect(() => {
    if (banners.length <= 1) return;
    const interval = setInterval(() => {
      setActiveBanner(prev => (prev + 1) % banners.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [banners.length]);

  const handleBannerTouchStart = (clientX: number) => {
    bannerTouchStartX.current = clientX;
    suppressBannerClick.current = false;
  };

  const handleBannerTouchEnd = (clientX: number) => {
    const startX = bannerTouchStartX.current;
    bannerTouchStartX.current = null;
    if (startX === null || banners.length <= 1) return;

    const deltaX = clientX - startX;
    if (Math.abs(deltaX) < 40) return;

    suppressBannerClick.current = true;
    setActiveBanner(prev => deltaX < 0
      ? (prev + 1) % banners.length
      : (prev - 1 + banners.length) % banners.length
    );
  };

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
          {!deviceOwnedKiosk && (
            <>
              <Link to="/clube" className="w-10 h-10 rounded-full vf-chip flex items-center justify-center text-[#FF7A00] hover:bg-[#FF7A00]/10 transition" title="Clube">
                <Sparkles className="w-[18px] h-[18px]" />
              </Link>
              <Link to="/meus-pedidos" className="relative w-10 h-10 rounded-full vf-chip flex items-center justify-center text-zinc-300 hover:text-white transition" title="Meus Pedidos">
                <ClipboardList className="w-[18px] h-[18px]" />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#FF7A00] text-white rounded-full text-[10px] font-bold flex items-center justify-center">{cartCount}</span>
                )}
              </Link>
            </>
          )}
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

      {/* Categories */}
      {!showFavorites && (
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
      )}

      {/* Banner rotativo */}
      {!showFavorites && banners.length > 0 && (
        <div className="px-4 sm:px-5 mt-5 vf-fade-in">
          <div
            className="vf-banner relative overflow-hidden h-32 sm:h-40 lg:h-48 max-w-[1200px] mx-auto border border-white/[0.06]"
            style={{ borderRadius: 24, touchAction: 'pan-y' }}
            onTouchStart={(event) => handleBannerTouchStart(event.touches[0]?.clientX ?? 0)}
            onTouchEnd={(event) => handleBannerTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
          >
            {banners.map((banner, i) => {
              const link = (banner as any).link || (banner as any).url || '';
              const go = () => { if (link) window.open(link, '_blank', 'noopener'); else onStart(); };
              return (
                <button
                  key={banner.id}
                  onClick={(event) => {
                    if (suppressBannerClick.current) {
                      event.preventDefault();
                      suppressBannerClick.current = false;
                      return;
                    }
                    go();
                  }}
                  aria-hidden={i !== activeBanner}
                  tabIndex={i === activeBanner ? 0 : -1}
                  className={`absolute inset-0 text-left transition-opacity duration-700 ${i === activeBanner ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                >
                  {isUrl(banner.image) ? (
                    <img src={banner.image} alt={banner.title || 'Banner'} className="w-full h-full object-cover" style={{ colorScheme: 'light' } as React.CSSProperties} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-7xl" style={{ background: 'linear-gradient(135deg, #FF7A00, #B23A00)' }}>{banner.image}</div>
                  )}
                </button>
              );
            })}
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

      {/* Mais pedidos / Favoritos */}
      <section className="mt-7 vf-fade-in">
        <div className="px-5 flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">{showFavorites ? 'Favoritos' : 'Mais pedidos'}</h2>
          {showFavorites ? (
            <button onClick={() => setShowFavorites(false)} className="text-[#FF7A00] text-sm font-semibold flex items-center gap-0.5 hover:underline">
              Voltar ao início
            </button>
          ) : (
            <button onClick={onStart} className="text-[#FF7A00] text-sm font-semibold flex items-center gap-0.5 hover:underline">
              Ver tudo <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 px-4 sm:px-5 max-w-[1200px] mx-auto">
          {displayedProducts.map((product, idx) => {
            const fav = favorites.includes(product.id);
            const badge = product.badge || (!showFavorites && idx === 0 ? 'Mais pedido' : product.oldPrice ? 'Oferta' : '');
            const promo = product.oldPrice && product.oldPrice > product.price;
            const eta = product.prepTimeMin && product.prepTimeMin > 0
              ? `${product.prepTimeMin}–${product.prepTimeMin + 10} min`
              : '30–40 min';
            return (
              <article key={product.id} className="vf-card relative overflow-hidden flex flex-col w-full min-w-0 h-full" style={{ borderRadius: 20 }}>
                <button onClick={() => onSelectProduct ? onSelectProduct(product) : setSelectedProduct(product)} className="text-left w-full min-w-0">
                  <div className="relative w-full aspect-[4/3] bg-zinc-900 overflow-hidden">
                    {isUrl(product.image) ? (
                      <img src={product.image} alt={product.name} className="w-full h-full object-cover transition-transform duration-500 hover:scale-105" style={{ colorScheme: 'light' } as React.CSSProperties} />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center text-6xl sm:text-7xl">{product.image}</span>
                    )}
                    {badge && (
                      <span className={`absolute top-2 left-2 text-white text-[9px] sm:text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 max-w-[85%] truncate ${promo && !product.badge && idx !== 0 ? 'bg-red-600' : 'bg-[#FF7A00]'}`}>
                        {!showFavorites && idx === 0 && !product.badge ? '🔥 ' : ''}{badge}
                      </span>
                    )}
                  </div>
                  <div className="p-3 sm:p-4 pb-2">
                    <h3 className="font-bold text-[13px] sm:text-[15px] text-white leading-tight line-clamp-1">{product.name}</h3>
                    <p className="text-[11px] sm:text-[12px] text-zinc-500 mt-1 line-clamp-2 leading-snug min-h-[30px]">{product.description || 'Feito na hora, com ingredientes selecionados.'}</p>
                    <div className="flex items-center gap-2 mt-2 text-[10px] sm:text-[11px] text-zinc-400 flex-wrap">
                      <span className="flex items-center gap-1"><Star className="w-3 h-3 fill-[#FF7A00] text-[#FF7A00]" /> <span className="text-white font-semibold">4,8</span></span>
                      <span className="w-px h-3 bg-zinc-700" />
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {eta}</span>
                    </div>
                  </div>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }}
                  aria-label={fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/45 backdrop-blur flex items-center justify-center text-white hover:bg-black/65 transition z-10"
                >
                  <Heart className={`w-[14px] h-[14px] ${fav ? 'fill-[#FF7A00] text-[#FF7A00]' : ''}`} />
                </button>
                <div className="px-3 sm:px-4 pb-3 sm:pb-4 mt-auto flex items-end justify-between gap-2 min-w-0">
                  <div className="min-w-0">
                    <div className="text-[#FF7A00] font-extrabold text-base sm:text-lg leading-tight truncate">{formatCurrency(product.price)}</div>
                    {promo && (
                      <div className="text-[11px] text-zinc-500 line-through leading-tight truncate">{formatCurrency(product.oldPrice!)}</div>
                    )}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleQuickAdd(product); }}
                    className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-full bg-[#FF7A00] text-white flex items-center justify-center shadow-[0_6px_20px_rgba(255,122,0,0.45)] active:scale-90 hover:brightness-110 transition"
                    title="Adicionar">
                    <Plus className="w-5 h-5" strokeWidth={2.5} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {showFavorites && displayedProducts.length === 0 && (
          <div className="px-5 py-12 text-center">
            <Heart className="w-12 h-12 mx-auto text-zinc-700 mb-3" />
            <p className="font-bold text-white">Nenhum favorito ainda</p>
            <p className="text-sm text-zinc-500 mt-1">Toque no coração de um produto para encontrá-lo aqui.</p>
          </div>
        )}
      </section>

      {/* Promo card */}
      {!showFavorites && (
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
      )}

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
        {!deviceOwnedKiosk && (
          <div className="mt-2">
            <Link to="/admin" className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300">
              <Settings className="w-3 h-3" /> Painel
            </Link>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 inset-x-0 z-40 px-3 pb-3 pt-2" style={{ background: 'linear-gradient(180deg, rgba(11,11,13,0) 0%, #0B0B0D 35%)' }}>
        <div className="vf-chip rounded-2xl flex items-center justify-around px-2 py-2 max-w-md mx-auto backdrop-blur" style={{ background: 'rgba(24,24,27,0.92)' }}>
          {[
            { icon: Home, label: 'Início', active: !showFavorites, onClick: () => { setShowFavorites(false); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
            { icon: Search, label: 'Buscar', onClick: onStart },
            ...(!deviceOwnedKiosk ? [{ icon: ClipboardList, label: 'Pedidos', to: '/meus-pedidos' }] : []),
            { icon: Heart, label: 'Favoritos', active: showFavorites, onClick: () => { setShowFavorites(true); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
            ...(!deviceOwnedKiosk ? [{ icon: User, label: 'Perfil', to: '/meus-pedidos' }] : []),
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
        <ProductModal product={selectedProduct} deviceOwnedKiosk={deviceOwnedKiosk}
          onAdd={(item) => { if (onAddToCart) onAddToCart(item); setSelectedProduct(null); }}
          onClose={() => setSelectedProduct(null)} />
      )}
    </div>
  );
};

export default StartScreen;
