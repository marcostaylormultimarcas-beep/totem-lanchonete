import { useState } from 'react';
import { X, Plus, Minus, Plug, Scale, AlertTriangle } from 'lucide-react';
import { Product, CartItem, formatCurrency, isByWeight } from '@/data/store';
import { useBalanca } from '@/hooks/useBalanca';

interface ProductModalProps {
  product: Product;
  onAdd: (item: CartItem) => void;
  onClose: () => void;
  baudRate?: number;
}

const ProductModal = ({ product, onAdd, onClose, baudRate = 9600 }: ProductModalProps) => {
  const [quantity, setQuantity] = useState(1);
  const [removedIngredients, setRemovedIngredients] = useState<string[]>([]);
  const [selectedExtras, setSelectedExtras] = useState<{ name: string; price: number }[]>([]);

  const byWeight = isByWeight(product);
  const balanca = useBalanca(baudRate);

  const toggleIngredient = (ing: string) => {
    setRemovedIngredients(prev =>
      prev.includes(ing) ? prev.filter(i => i !== ing) : [...prev, ing]
    );
  };

  const toggleExtra = (extra: { name: string; price: number }) => {
    setSelectedExtras(prev =>
      prev.find(e => e.name === extra.name)
        ? prev.filter(e => e.name !== extra.name)
        : [...prev, extra]
    );
  };

  const extrasTotal = selectedExtras.reduce((sum, e) => sum + e.price, 0);
  const unitPrice = product.price + extrasTotal;
  const total = byWeight
    ? unitPrice * (balanca.pesoAtual || 0)
    : unitPrice * quantity;

  const canAdd = byWeight ? balanca.pesoAtual > 0 : quantity > 0;

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

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-card w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[85vh] overflow-y-auto border border-border"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            {product.image.startsWith('http') || product.image.startsWith('/') ? (
              <img src={product.image} alt={product.name} className="w-14 h-14 object-cover rounded-xl" />
            ) : (
              <span className="text-4xl">{product.image}</span>
            )}
            <div>
              <h3 className="font-bold text-lg">{product.name}</h3>
              <p className="text-primary font-black">
                {formatCurrency(product.price)}{byWeight ? <span className="text-xs text-muted-foreground font-semibold"> / kg</span> : null}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* === BALANÇA (somente produtos por peso) === */}
          {byWeight && (
            <div className="rounded-2xl bg-zinc-900 border border-amber-500/50 shadow-[0_0_25px_rgba(245,158,11,0.18)] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale className="w-5 h-5 text-amber-400" />
                  <span className="text-xs uppercase tracking-wider font-bold text-amber-400">Peso na Balança</span>
                </div>
                <button
                  type="button"
                  onClick={() => balanca.balancaConectada ? balanca.desconectarBalanca() : balanca.conectarBalanca()}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                    balanca.balancaConectada
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-zinc-800 text-amber-300 border-amber-500/40 hover:bg-zinc-700'
                  }`}
                  title={balanca.balancaConectada ? 'Desconectar balança' : 'Conectar balança via cabo USB/Serial'}
                >
                  <Plug className="w-3.5 h-3.5" />
                  {balanca.balancaConectada ? 'Conectada' : 'Conectar'}
                </button>
              </div>

              <p className="text-amber-400 font-bold text-3xl tabular-nums tracking-tight">
                {balanca.pesoAtual.toFixed(3)} <span className="text-xl text-amber-500/70">kg</span>
              </p>

              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">
                  Subtotal: <span className="text-emerald-400 font-bold text-sm">{formatCurrency(total)}</span>
                </span>
                <span className={`font-semibold ${balanca.balancaConectada ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {balanca.balancaConectada ? '● Ao vivo' : '○ Aguardando'}
                </span>
              </div>

              {!balanca.supported && (
                <div className="flex items-start gap-2 text-[11px] text-amber-300/80 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Este navegador não suporta Web Serial. Use Chrome/Edge em HTTPS no TV Box.</span>
                </div>
              )}
              {balanca.error && (
                <div className="flex items-start gap-2 text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{balanca.error}</span>
                </div>
              )}
            </div>
          )}

          {/* Ingredients list */}
          {product.ingredients && product.ingredients.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm text-primary mb-3 uppercase tracking-wider">Ingredientes</h4>
              <ul className="space-y-1.5">
                {product.ingredients.map((ing, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/90">
                    <span className="text-primary mt-1">•</span>
                    <span>{ing}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Marketing description */}
          {product.description && product.description.trim() && (
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
              <h4 className="font-semibold text-xs text-primary mb-2 uppercase tracking-wider">Sobre este produto</h4>
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">{product.description}</p>
            </div>
          )}
          {/* Remove Ingredients — toggles */}
          {product.removableIngredients.length > 0 && (
            <div>
              <h4 className="font-semibold text-xs text-zinc-400 mb-3 uppercase tracking-wider">Remover ingredientes</h4>
              <div className="space-y-2">
                {product.removableIngredients.map(ing => {
                  const on = removedIngredients.includes(ing);
                  return (
                    <button
                      type="button"
                      key={ing}
                      onClick={() => toggleIngredient(ing)}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all duration-200 active:scale-[0.98] ${
                        on
                          ? "bg-red-500/10 border-red-500/60"
                          : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <span className="text-sm font-semibold text-white">Sem {ing}</span>
                      <span
                        className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${
                          on ? "bg-red-500" : "bg-zinc-700"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-200 ${
                            on ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Extras — toggles */}
          {product.extras.length > 0 && (
            <div>
              <h4 className="font-semibold text-xs text-zinc-400 mb-3 uppercase tracking-wider">Adicionais</h4>
              <div className="space-y-2">
                {product.extras.map(extra => {
                  const on = !!selectedExtras.find(e => e.name === extra.name);
                  return (
                    <button
                      type="button"
                      key={extra.name}
                      onClick={() => toggleExtra(extra)}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all duration-200 active:scale-[0.98] ${
                        on
                          ? "bg-gradient-to-br from-amber-500/15 to-orange-600/10 border-amber-500"
                          : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex flex-col items-start gap-0.5">
                        <span className="text-sm font-semibold text-white">{extra.name}</span>
                        <span className="text-xs text-amber-400 font-bold">+{formatCurrency(extra.price)}</span>
                      </div>
                      <span
                        className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${
                          on ? "bg-amber-500" : "bg-zinc-700"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-200 ${
                            on ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantity (oculto em produtos por peso) */}
          {!byWeight && (
            <div className="flex items-center justify-center gap-6">
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center active:scale-90"
              >
                <Minus className="w-5 h-5" />
              </button>
              <span className="text-2xl font-black w-8 text-center">{quantity}</span>
              <button
                onClick={() => setQuantity(q => q + 1)}
                className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-zinc-950 flex items-center justify-center active:scale-90"
              >
                <Plus className="w-5 h-5" strokeWidth={3} />
              </button>
            </div>
          )}
        </div>

        {/* Add Button */}
        <div className="p-5 border-t border-zinc-800">
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="btn-premium w-full py-4 text-lg"
          >
            {byWeight && balanca.pesoAtual <= 0
              ? 'Coloque o produto na balança'
              : `Adicionar — ${formatCurrency(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductModal;
