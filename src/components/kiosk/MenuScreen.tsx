import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ShoppingCart, Plus, Search } from 'lucide-react';
import { getItemTotal, CartItem, Product, CategoryItem, isByWeight } from '@/data/store';
import { useOrgId } from '@/contexts/OrgContext';
import { fetchPublicStorefrontConfig } from '@/lib/publicStorefrontConfig';
import { fetchPublicCatalog } from '@/lib/publicCatalog';
import { fetchPublicCombo } from '@/lib/publicCombo';
import ProductModal from './ProductModal';
import UpsellPopup from './UpsellPopup';
import { formatCurrency } from '@/data/store';
import { toast } from 'sonner';

interface MenuScreenProps {
  cart: CartItem[];
  onAddToCart: (item: CartItem) => void;
  onGoToCart: () => void;
  onBack: () => void;
  initialProduct?: Product | null;
  onInitialProductHandled?: () => void;
  deviceOwnedKiosk?: boolean;
}

const DEFAULT_CATEGORIES: CategoryItem[] = [
  { key: 'hamburgueres', label: 'Hambúrgueres', icon: '🍔' },
  { key: 'pizzas', label: 'Pizzas', icon: '🍕' },
  { key: 'bebidas', label: 'Bebidas', icon: '🥤' },
];

const MenuScreen = ({ cart, onAddToCart, onGoToCart, onBack, initialProduct, onInitialProductHandled, deviceOwnedKiosk = false }: MenuScreenProps) => {
  const orgId = useOrgId();
  const [categories, setCategories] = useState<CategoryItem[]>(DEFAULT_CATEGORIES);
  const [activeCategory, setActiveCategory] = useState<string>('hamburgueres');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showUpsell, setShowUpsell] = useState(false);
  const [pendingItem, setPendingItem] = useState<CartItem | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [comboProduct, setComboProduct] = useState<Product | null>(null);
  const [balancaBaud, setBalancaBaud] = useState(9600);

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    const [prods, settingsData, publicCombo] = await Promise.all([
      fetchPublicCatalog(orgId).catch(error => {
        console.warn('[Menu] public catalog error:', error);
        return [];
      }),
      fetchPublicStorefrontConfig(orgId).catch(error => {
        console.warn('[Menu] storefront config error:', error);
        return {};
      }),
      fetchPublicCombo(orgId).catch(error => {
        console.warn('[Menu] public combo error:', error);
        return null;
      }),
    ]);
    const mappedProducts = prods.map((p) => ({
      id: p.id, name: p.name, price: Number(p.price), category: p.category,
      image: p.image || '', removableIngredients: (p.removable_ingredients as string[]) || [],
      extras: (p.extras as { name: string; price: number }[]) || [], isCombo: p.is_combo || false,
      ingredients: (p.ingredients as string[]) || [], description: p.description || '',
      soldByWeight: Boolean(p.sold_by_weight),
      codigoBarras: p.codigo_barras || undefined,
      prepTimeMin: Number(p.prep_time_min ?? 0),
    })) as Product[];

    const comboConfig = (settingsData.combo || {}) as { product_id?: string };
    const linkedCombo = comboConfig.product_id
      ? mappedProducts.find((product) => product.id === comboConfig.product_id && product.isCombo)
      : null;
    const authoritativeCombos = mappedProducts.filter(
      (product) => product.isCombo && product.category === 'visionfood_combo',
    );
    const mappedPublicCombo = publicCombo ? ({
      id: publicCombo.id,
      name: publicCombo.name,
      price: Number(publicCombo.price),
      category: publicCombo.category,
      image: publicCombo.image || '',
      removableIngredients: (publicCombo.removable_ingredients as string[]) || [],
      extras: (publicCombo.extras as { name: string; price: number }[]) || [],
      isCombo: Boolean(publicCombo.is_combo),
      ingredients: (publicCombo.ingredients as string[]) || [],
      description: publicCombo.description || '',
      soldByWeight: Boolean(publicCombo.sold_by_weight),
      codigoBarras: publicCombo.codigo_barras || undefined,
      prepTimeMin: Number(publicCombo.prep_time_min ?? 0),
    }) as Product : null;

    setComboProduct(
      mappedPublicCombo
      || linkedCombo
      || (authoritativeCombos.length === 1 ? authoritativeCombos[0] : null),
    );
    setProducts(mappedProducts.filter((product) => !product.isCombo));
    const baud = Number(settingsData.balanca_baud_rate ?? 9600);
    if (baud) setBalancaBaud(baud);
    const cats = settingsData.categories as CategoryItem[] | undefined;
    if (cats && cats.length > 0) {
      setCategories(cats);
      setActiveCategory(prev => cats.find(c => c.key === prev) ? prev : cats[0].key);
    }
  }, [orgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Catálogo e configurações públicas são atualizados por contratos RPC seguros.
  useEffect(() => {
    if (!orgId) return;
    const pollId = window.setInterval(fetchData, 30000);
    return () => { window.clearInterval(pollId); };
  }, [orgId, fetchData]);


  useEffect(() => {
    if (initialProduct) {
      setActiveCategory(initialProduct.category);
      setSelectedProduct(initialProduct);
      onInitialProductHandled?.();
    }
  }, [initialProduct, onInitialProductHandled]);

  // === Leitor global de código de barras (scanner físico USB/Bluetooth) ===
  const scanBufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);

  const playScanBeep = () => {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(2100, ctx.currentTime);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.13);
      setTimeout(() => ctx.close(), 200);
    } catch {}
  };

  const handleBarcodeScanned = (code: string) => {
    const clean = code.replace(/\D/g, '');
    if (clean.length < 6) return;
    const product = products.find(p => (p.codigoBarras || '').replace(/\D/g, '') === clean);
    if (!product) {
      toast.error(`Código ${clean} não encontrado`, {
        style: { background: '#18181b', color: '#fbbf24', border: '1px solid #27272a' },
      });
      return;
    }
    playScanBeep();
    if (isByWeight(product)) {
      setActiveCategory(product.category);
      setSelectedProduct(product);
      toast(`⚖️ Pese: ${product.name}`, {
        style: { background: '#18181b', color: '#fbbf24', border: '1px solid #27272a' },
      });
      return;
    }
    const item: CartItem = {
      id: crypto.randomUUID(),
      product,
      quantity: 1,
      removedIngredients: [],
      selectedExtras: [],
    };
    onAddToCart(item);
    toast(`🛒 ${product.name} adicionado ao carrinho!`, {
      style: { background: '#18181b', color: '#fbbf24', border: '1px solid #27272a' },
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      const now = Date.now();
      const delta = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === 'Enter') {
        const buf = scanBufferRef.current;
        scanBufferRef.current = '';
        if (buf.length >= 6 && !editing) {
          e.preventDefault();
          handleBarcodeScanned(buf);
        }
        return;
      }
      if (e.key.length !== 1) return;
      // Scanners emit characters very fast (<30ms typical between keys)
      if (delta > 80) scanBufferRef.current = '';
      scanBufferRef.current += e.key;
      // Cap buffer
      if (scanBufferRef.current.length > 32) scanBufferRef.current = scanBufferRef.current.slice(-32);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);


  const filtered = products.filter(p => p.category === activeCategory);
  const cartTotal = cart.reduce((sum, item) => sum + getItemTotal(item), 0);

  const handleAddItem = (item: CartItem) => {
    if (
      comboProduct &&
      (item.product.category === 'hamburgueres' || item.product.category === 'pizzas')
    ) {
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
      if (comboProduct) {
        onAddToCart({
          id: crypto.randomUUID(),
          product: comboProduct,
          quantity: 1,
          removedIngredients: [],
          selectedExtras: [],
        });
      }
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
        <div className="flex gap-4 px-4 py-3 overflow-x-auto whitespace-nowrap">
          {categories.map(cat => {
            const active = activeCategory === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className="touch-btn flex flex-col items-center gap-2 flex-shrink-0 group"
              >
                <span
                  className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center bg-zinc-900 border transition-all duration-300 overflow-hidden ${
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
                    : <span className={`text-2xl sm:text-3xl ${active ? 'scale-110' : ''} transition-transform`}>{cat.icon}</span>)}
                </span>
                <span className={`text-[11px] sm:text-xs font-semibold ${active ? 'text-amber-400' : 'text-zinc-400 group-hover:text-zinc-200'} transition-colors`}>
                  {cat.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Grid de produtos noturno */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 px-3 sm:px-4 pb-6 content-start auto-rows-max max-w-[1200px] mx-auto w-full">
          {filtered.map(product => {
            const isUrlImg = product.image.startsWith('http') || product.image.startsWith('/');
            return (
              <article
                key={product.id}
                className="group bg-zinc-900 border border-zinc-800/90 rounded-2xl overflow-hidden self-start text-left transition-all hover:border-amber-500/50 hover:shadow-[0_12px_28px_-14px_rgba(245,158,11,0.32)]"
              >
                <button
                  onClick={() => setSelectedProduct(product)}
                  className="w-full aspect-[4/3] bg-zinc-950/60 overflow-hidden block"
                >
                  {isUrlImg ? (
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-6xl sm:text-7xl">{product.image}</span>
                  )}
                </button>

                <div className="p-3">
                  <button onClick={() => setSelectedProduct(product)} className="w-full text-left">
                    <span className="font-bold text-sm sm:text-base leading-tight line-clamp-1 text-white">{product.name}</span>
                    {product.description && (
                      <span className="block text-[11px] sm:text-xs text-zinc-500 mt-1 line-clamp-1">
                        {product.description}
                      </span>
                    )}
                  </button>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-amber-400 font-black text-lg sm:text-xl tracking-tight tabular-nums">
                      {formatCurrency(product.price)}
                    </span>
                    <button
                      onClick={() => setSelectedProduct(product)}
                      aria-label={`Adicionar ${product.name}`}
                      className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-full flex items-center justify-center bg-gradient-to-br from-amber-400 to-orange-600 text-zinc-950 shadow-[0_6px_16px_rgba(245,158,11,0.35)] active:scale-90 hover:scale-105 transition-transform"
                    >
                      <Plus className="w-5 h-5" strokeWidth={3} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* Cart */}
      {cart.length > 0 && (
        <>
          <div className="fixed bottom-0 left-0 right-0 bg-zinc-950/96 backdrop-blur border-t border-zinc-800 px-3 pt-2.5 pb-[calc(0.65rem+env(safe-area-inset-bottom))] lg:hidden z-30">
            <button onClick={onGoToCart} className="touch-btn w-full max-w-md mx-auto bg-gradient-to-r from-amber-500 to-orange-600 text-zinc-950 rounded-xl px-4 py-3 flex items-center gap-3 shadow-[0_8px_24px_rgba(245,158,11,0.25)] active:scale-[0.99] transition-transform">
              <div className="w-9 h-9 rounded-full bg-black/10 flex items-center justify-center shrink-0">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0 text-left leading-tight">
                <p className="font-black text-base">Ver carrinho</p>
                <p className="text-xs font-semibold opacity-75">{cart.length} {cart.length === 1 ? 'item' : 'itens'}</p>
              </div>
              <span className="font-black text-lg tabular-nums whitespace-nowrap">{formatCurrency(cartTotal)}</span>
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
        <ProductModal product={selectedProduct} baudRate={balancaBaud} deviceOwnedKiosk={deviceOwnedKiosk} onAdd={handleAddItem} onClose={() => setSelectedProduct(null)} />
      )}
      {showUpsell && comboProduct && (
        <UpsellPopup combo={comboProduct} onAccept={handleUpsellAccept} onDecline={handleUpsellDecline} />
      )}
    </div>
  );
};

export default MenuScreen;
