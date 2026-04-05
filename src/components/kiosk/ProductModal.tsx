import { useState } from 'react';
import { X, Plus, Minus } from 'lucide-react';
import { Product, CartItem, formatCurrency } from '@/data/store';

interface ProductModalProps {
  product: Product;
  onAdd: (item: CartItem) => void;
  onClose: () => void;
}

const ProductModal = ({ product, onAdd, onClose }: ProductModalProps) => {
  const [quantity, setQuantity] = useState(1);
  const [removedIngredients, setRemovedIngredients] = useState<string[]>([]);
  const [selectedExtras, setSelectedExtras] = useState<{ name: string; price: number }[]>([]);

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
  const total = unitPrice * quantity;

  const handleAdd = () => {
    onAdd({
      id: crypto.randomUUID(),
      product,
      quantity,
      removedIngredients,
      selectedExtras,
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
              <p className="text-primary font-black">{formatCurrency(product.price)}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Remove Ingredients */}
          {product.removableIngredients.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm text-muted-foreground mb-3">REMOVER INGREDIENTES</h4>
              <div className="space-y-2">
                {product.removableIngredients.map(ing => (
                  <label key={ing} className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 cursor-pointer active:bg-muted">
                    <input
                      type="checkbox"
                      checked={removedIngredients.includes(ing)}
                      onChange={() => toggleIngredient(ing)}
                      className="w-5 h-5 rounded accent-secondary"
                    />
                    <span className="text-sm">Sem {ing}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Extras */}
          {product.extras.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm text-muted-foreground mb-3">ADICIONAIS</h4>
              <div className="space-y-2">
                {product.extras.map(extra => (
                  <label
                    key={extra.name}
                    className={`flex items-center justify-between p-3 rounded-xl cursor-pointer active:bg-muted transition-all ${
                      selectedExtras.find(e => e.name === extra.name) ? 'bg-primary/20 border border-primary' : 'bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={!!selectedExtras.find(e => e.name === extra.name)}
                        onChange={() => toggleExtra(extra)}
                        className="w-5 h-5 rounded accent-primary"
                      />
                      <span className="text-sm font-medium">{extra.name}</span>
                    </div>
                    <span className="text-primary font-bold text-sm">+{formatCurrency(extra.price)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Quantity */}
          <div className="flex items-center justify-center gap-6">
            <button
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center active:scale-90"
            >
              <Minus className="w-5 h-5" />
            </button>
            <span className="text-2xl font-black w-8 text-center">{quantity}</span>
            <button
              onClick={() => setQuantity(q => q + 1)}
              className="w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center active:scale-90"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Add Button */}
        <div className="p-5 border-t border-border">
          <button
            onClick={handleAdd}
            className="touch-btn w-full bg-primary text-primary-foreground py-4 rounded-xl text-lg"
          >
            Adicionar — {formatCurrency(total)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductModal;
