import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Minus, Plug, Scale, AlertTriangle, Star, Clock, Flame, ShoppingCart, Heart, Share2, MessageSquare } from 'lucide-react';
import { Product, CartItem, formatCurrency, isByWeight } from '@/data/store';
import { useBalanca } from '@/hooks/useBalanca';
import { useOrgId } from '@/contexts/OrgContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ProductModalProps {
  product: Product;
  onAdd: (item: CartItem) => void;
  onClose: () => void;
  baudRate?: number;
}

interface ReviewRow {
  id: string;
  user_id: string;
  rating: number;
  comment: string;
  created_at: string;
  author_name?: string;
}

const ProductModal = ({ product, onAdd, onClose, baudRate = 9600 }: ProductModalProps) => {
  const orgId = useOrgId();
  const [quantity, setQuantity] = useState(1);
  const [removedIngredients, setRemovedIngredients] = useState<string[]>([]);
  const [selectedExtras, setSelectedExtras] = useState<{ name: string; price: number }[]>([]);
  const [tempoBase, setTempoBase] = useState<number>(20);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [eligibleOrderId, setEligibleOrderId] = useState<string | null>(null);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [myRating, setMyRating] = useState(5);
  const [myComment, setMyComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [favorite, setFavorite] = useState(false);

  const byWeight = isByWeight(product);
  const balanca = useBalanca(baudRate);

  // Tempo base da loja
  useEffect(() => {
    if (!orgId) return;
    supabase.from('settings').select('delivery_tempo_base_min').eq('organization_id', orgId).maybeSingle()
      .then(({ data }) => { if (data?.delivery_tempo_base_min) setTempoBase(Number(data.delivery_tempo_base_min)); });
  }, [orgId]);

  // Carrega avaliações
  const fetchReviews = async () => {
    const { data } = await supabase
      .from('product_reviews' as any)
      .select('id,user_id,rating,comment,created_at')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!data) return;
    const rows = data as any as ReviewRow[];
    // Tenta enriquecer com nome do profile
    const ids = Array.from(new Set(rows.map(r => r.user_id)));
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id,full_name').in('id', ids);
      const map = new Map<string, string>();
      (profs || []).forEach((p: any) => map.set(p.id, p.full_name || ''));
      rows.forEach(r => { r.author_name = map.get(r.user_id) || 'Cliente'; });
    }
    setReviews(rows);
  };

  useEffect(() => { fetchReviews(); }, [product.id]);

  // Verifica sessão e elegibilidade pra avaliar
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id || null);
      if (!user) { setCanReview(false); return; }
      // Procura pedido concluído deste cliente que contenha este produto
      const { data: orders } = await supabase
        .from('orders')
        .select('id,items,status')
        .eq('user_id', user.id)
        .in('status', ['delivered', 'completed', 'ready'])
        .order('created_at', { ascending: false })
        .limit(50);
      const eligible = (orders || []).find((o: any) => {
        const items = Array.isArray(o.items) ? o.items : [];
        return items.some((it: any) => it?.product?.id === product.id || it?.productId === product.id);
      });
      if (eligible) {
        setEligibleOrderId(eligible.id);
        setCanReview(true);
      }
    })();
  }, [product.id]);

  const avg = useMemo(() => {
    if (!reviews.length) return 0;
    return reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  }, [reviews]);

  const toggleIngredient = (ing: string) => {
    setRemovedIngredients(prev => prev.includes(ing) ? prev.filter(i => i !== ing) : [...prev, ing]);
  };
  const toggleExtra = (extra: { name: string; price: number }) => {
    setSelectedExtras(prev => prev.find(e => e.name === extra.name) ? prev.filter(e => e.name !== extra.name) : [...prev, extra]);
  };

  const extrasTotal = selectedExtras.reduce((sum, e) => sum + e.price, 0);
  const unitPrice = product.price + extrasTotal;
  const total = byWeight ? unitPrice * (balanca.pesoAtual || 0) : unitPrice * quantity;
  const canAdd = byWeight ? balanca.pesoAtual > 0 : quantity > 0;

  // Tempo estimado
  const prepPerUnit = Math.max(0, Number(product.prepTimeMin || 0));
  const qtyForTime = byWeight ? 1 : quantity;
  const tempoMin = tempoBase + prepPerUnit * qtyForTime;
  const tempoMax = tempoMin + 10;

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd({
      id: crypto.randomUUID(),
      product,
      quantity: byWeight ? 1 : quantity,
      removedIngredients,
      selectedExtras,
      weightKg: byWeight ? balanca.pesoAtual : undefined,
    });
  };

  const submitReview = async () => {
    if (!userId || !eligibleOrderId) return;
    setSubmitting(true);
    const { error } = await supabase.from('product_reviews' as any).upsert({
      product_id: product.id,
      organization_id: orgId,
      user_id: userId,
      order_id: eligibleOrderId,
      rating: myRating,
      comment: myComment.trim(),
    }, { onConflict: 'product_id,user_id,order_id' });
    setSubmitting(false);
    if (error) { toast.error('Não foi possível salvar a avaliação.'); return; }
    toast.success('Avaliação enviada — obrigado!');
    setShowReviewForm(false);
    setMyComment('');
    fetchReviews();
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: product.name, text: product.description || product.name, url });
      else { await navigator.clipboard.writeText(url); toast.success('Link copiado'); }
    } catch {}
  };

  const isImageUrl = product.image?.startsWith('http') || product.image?.startsWith('/');

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/90 backdrop-blur-md flex items-end sm:items-center justify-center animate-fade-in" onClick={onClose}>
      <div
        className="bg-zinc-950 w-full sm:max-w-md sm:rounded-3xl max-h-[95vh] sm:max-h-[92vh] overflow-y-auto border-t sm:border border-zinc-800 shadow-2xl animate-scale-in"
        onClick={e => e.stopPropagation()}
        style={{ colorScheme: 'light' }}
      >
        {/* ============= HERO IMAGE ============= */}
        <div className="relative w-full h-72 sm:h-80 bg-zinc-900">
          {isImageUrl ? (
            <img src={product.image} alt={product.name} className="w-full h-full object-cover" style={{ filter: 'none', colorScheme: 'light' }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-8xl bg-gradient-to-br from-zinc-900 to-zinc-800">{product.image}</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-zinc-950/95 pointer-events-none" />

          {/* Top actions */}
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
            <button onClick={onClose} className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center justify-center text-white active:scale-90 transition-transform">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <button onClick={handleShare} className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center justify-center text-white active:scale-90">
                <Share2 className="w-5 h-5" />
              </button>
              <button onClick={() => setFavorite(f => !f)} className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center justify-center active:scale-90">
                <Heart className={`w-5 h-5 ${favorite ? 'fill-orange-500 text-orange-500' : 'text-white'}`} />
              </button>
            </div>
          </div>

          {/* Mais pedido badge if has reviews & avg high */}
          {reviews.length >= 3 && avg >= 4.5 && (
            <div className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-500 text-white text-xs font-bold shadow-lg">
              <Flame className="w-3.5 h-3.5" /> Mais pedido
            </div>
          )}
        </div>

        {/* ============= HEADER INFO ============= */}
        <div className="px-5 pt-5 pb-3">
          <h1 className="text-2xl font-black text-white tracking-tight leading-tight">{product.name}</h1>
          {product.description && (
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{product.description}</p>
          )}

          {/* Rating + Tempo */}
          <div className="mt-4 flex items-center gap-5">
            <div className="flex items-center gap-1.5">
              <Star className="w-5 h-5 text-orange-400 fill-orange-400" />
              <div className="flex flex-col leading-tight">
                <span className="text-white font-bold text-sm">{reviews.length ? avg.toFixed(1) : '—'}</span>
                <span className="text-[10px] text-zinc-500">{reviews.length} avaliaç{reviews.length === 1 ? 'ão' : 'ões'}</span>
              </div>
            </div>
            <div className="h-8 w-px bg-zinc-800" />
            <div className="flex items-center gap-1.5">
              <Clock className="w-5 h-5 text-orange-400" />
              <div className="flex flex-col leading-tight">
                <span className="text-white font-bold text-sm">{tempoMin}–{tempoMax} min</span>
                <span className="text-[10px] text-zinc-500">Tempo estimado</span>
              </div>
            </div>
            {product.category && (
              <>
                <div className="h-8 w-px bg-zinc-800" />
                <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">{product.category}</span>
              </>
            )}
          </div>

          {/* Preço grande */}
          <p className="mt-5 text-4xl font-black bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent tabular-nums">
            {formatCurrency(product.price)}
            {byWeight && <span className="text-base text-zinc-500 font-bold"> / kg</span>}
          </p>
        </div>

        <div className="h-px bg-zinc-800 mx-5" />

        {/* ============= CONTENT ============= */}
        <div className="px-5 py-5 space-y-6">
          {/* Balança */}
          {byWeight && (
            <div className="rounded-2xl bg-zinc-900 border border-amber-500/40 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale className="w-5 h-5 text-amber-400" />
                  <span className="text-xs uppercase tracking-wider font-bold text-amber-400">Peso na Balança</span>
                </div>
                <button
                  type="button"
                  onClick={() => balanca.balancaConectada ? balanca.desconectarBalanca() : balanca.conectarBalanca()}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${balanca.balancaConectada ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-zinc-800 text-amber-300 border-amber-500/40'}`}
                >
                  <Plug className="w-3.5 h-3.5" />
                  {balanca.balancaConectada ? 'Conectada' : 'Conectar'}
                </button>
              </div>
              <p className="text-amber-400 font-bold text-3xl tabular-nums">{balanca.pesoAtual.toFixed(3)} <span className="text-xl text-amber-500/70">kg</span></p>
              {!balanca.supported && (
                <div className="flex items-start gap-2 text-[11px] text-amber-300/80"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />Use Chrome/Edge em HTTPS.</div>
              )}
              {balanca.error && <p className="text-[11px] text-red-300">{balanca.error}</p>}
            </div>
          )}

          {/* Ingredientes do produto (lista informativa) */}
          {product.ingredients && product.ingredients.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Ingredientes</h4>
              <p className="text-sm text-zinc-300 leading-relaxed">{product.ingredients.join(' · ')}</p>
            </div>
          )}

          {/* Remover ingredientes */}
          {product.removableIngredients.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-white mb-3">Remover ingredientes</h4>
              <div className="space-y-2.5">
                {product.removableIngredients.map(ing => {
                  const on = removedIngredients.includes(ing);
                  return (
                    <button
                      type="button"
                      key={ing}
                      onClick={() => toggleIngredient(ing)}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-[0.98] ${on ? 'bg-red-500/10 border-red-500/60' : 'bg-zinc-900 border-zinc-800'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${on ? 'bg-red-500/20' : 'bg-zinc-800'}`}>🥗</div>
                        <div className="text-left">
                          <p className="text-sm font-semibold text-white">Sem {ing}</p>
                          <p className="text-[11px] text-zinc-500">Remove este item do produto</p>
                        </div>
                      </div>
                      <IOSSwitch on={on} color="red" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Adicionais */}
          {product.extras.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-white mb-3">Adicionais</h4>
              <div className="space-y-2.5">
                {product.extras.map(extra => {
                  const on = !!selectedExtras.find(e => e.name === extra.name);
                  return (
                    <button
                      type="button"
                      key={extra.name}
                      onClick={() => toggleExtra(extra)}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-[0.98] ${on ? 'bg-gradient-to-br from-orange-500/15 to-orange-600/5 border-orange-500/60' : 'bg-zinc-900 border-zinc-800'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${on ? 'bg-orange-500/20' : 'bg-zinc-800'}`}>➕</div>
                        <div className="text-left">
                          <p className="text-sm font-semibold text-white">{extra.name}</p>
                          <p className="text-[11px] text-orange-400 font-bold">+ {formatCurrency(extra.price)}</p>
                        </div>
                      </div>
                      <IOSSwitch on={on} color="orange" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantidade */}
          {!byWeight && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-sm font-bold text-white">Quantidade</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white active:scale-90 transition-transform"
                >
                  <Minus className="w-5 h-5" />
                </button>
                <span className="text-2xl font-black w-8 text-center text-white tabular-nums">{quantity}</span>
                <button
                  onClick={() => setQuantity(q => q + 1)}
                  className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white shadow-lg shadow-orange-500/30 active:scale-90 transition-transform"
                >
                  <Plus className="w-5 h-5" strokeWidth={3} />
                </button>
              </div>
            </div>
          )}

          {/* ============= AVALIAÇÕES ============= */}
          <div className="pt-4 border-t border-zinc-800">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-orange-400" /> Avaliações
              </h4>
              {canReview && !showReviewForm && (
                <button onClick={() => setShowReviewForm(true)} className="text-xs font-bold text-orange-400 hover:text-orange-300">+ Avaliar</button>
              )}
            </div>

            {/* Resumo */}
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-zinc-900 border border-zinc-800 mb-3">
              <div className="text-center">
                <p className="text-3xl font-black text-white tabular-nums">{reviews.length ? avg.toFixed(1) : '—'}</p>
                <div className="flex gap-0.5 mt-1 justify-center">
                  {[1,2,3,4,5].map(i => (
                    <Star key={i} className={`w-3 h-3 ${i <= Math.round(avg) ? 'text-orange-400 fill-orange-400' : 'text-zinc-700'}`} />
                  ))}
                </div>
              </div>
              <div className="flex-1 text-xs text-zinc-400">
                {reviews.length === 0 ? 'Seja o primeiro a avaliar este produto após receber seu pedido.' : `${reviews.length} cliente${reviews.length === 1 ? '' : 's'} avaliaram este produto.`}
              </div>
            </div>

            {/* Form */}
            {showReviewForm && (
              <div className="rounded-2xl bg-zinc-900 border border-orange-500/30 p-4 mb-3 space-y-3">
                <p className="text-xs font-semibold text-white">Sua nota</p>
                <div className="flex items-center gap-1">
                  {[1,2,3,4,5].map(i => (
                    <button key={i} onClick={() => setMyRating(i)} className="active:scale-90 transition-transform">
                      <Star className={`w-8 h-8 ${i <= myRating ? 'text-orange-400 fill-orange-400' : 'text-zinc-700'}`} />
                    </button>
                  ))}
                </div>
                <textarea
                  value={myComment}
                  onChange={e => setMyComment(e.target.value)}
                  placeholder="Conte como foi sua experiência (opcional)"
                  rows={3}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder:text-zinc-600 outline-none focus:border-orange-500/50"
                />
                <div className="flex gap-2">
                  <button onClick={() => setShowReviewForm(false)} className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-white text-sm font-semibold active:scale-95">Cancelar</button>
                  <button onClick={submitReview} disabled={submitting} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-orange-400 to-orange-600 text-white text-sm font-bold active:scale-95 disabled:opacity-50">
                    {submitting ? 'Enviando…' : 'Enviar avaliação'}
                  </button>
                </div>
              </div>
            )}

            {/* Lista */}
            {reviews.length > 0 && (
              <div className="space-y-2">
                {reviews.slice(0, 5).map(r => (
                  <div key={r.id} className="p-3 rounded-2xl bg-zinc-900 border border-zinc-800">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-bold text-white">{r.author_name || 'Cliente'}</p>
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map(i => (
                          <Star key={i} className={`w-3 h-3 ${i <= r.rating ? 'text-orange-400 fill-orange-400' : 'text-zinc-700'}`} />
                        ))}
                      </div>
                    </div>
                    {r.comment && <p className="text-xs text-zinc-400 leading-relaxed">{r.comment}</p>}
                    <p className="text-[10px] text-zinc-600 mt-1">{new Date(r.created_at).toLocaleDateString('pt-BR')}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ============= BOTÃO FIXO ============= */}
        <div className="sticky bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-zinc-950 via-zinc-950 to-zinc-950/80 backdrop-blur-md border-t border-zinc-800">
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="w-full h-14 rounded-2xl bg-gradient-to-r from-orange-400 to-orange-600 text-white font-black shadow-lg shadow-orange-500/30 active:scale-[0.98] disabled:opacity-50 transition-all flex items-center justify-between px-5"
          >
            <span className="text-lg tabular-nums">{formatCurrency(total)}</span>
            <span className="flex items-center gap-2 text-base">
              {byWeight && balanca.pesoAtual <= 0 ? 'Coloque na balança' : 'Adicionar ao carrinho'}
              <span className="w-9 h-9 rounded-xl bg-black/25 flex items-center justify-center">
                <ShoppingCart className="w-4 h-4" />
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

const IOSSwitch = ({ on, color = 'orange' }: { on: boolean; color?: 'orange' | 'red' }) => (
  <span className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${on ? (color === 'red' ? 'bg-red-500' : 'bg-orange-500') : 'bg-zinc-700'}`}>
    <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
  </span>
);

export default ProductModal;
