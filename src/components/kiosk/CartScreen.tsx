import { ArrowLeft, Trash2 } from 'lucide-react';
import { CartItem, getItemTotal, formatCurrency } from '@/data/store';

interface CartScreenProps {
  cart: CartItem[];
  onRemove: (id: string) => void;
  onCheckout: () => void;
  onBack: () => void;
}

const CartScreen = ({ cart, onRemove, onCheckout, onBack }: CartScreenProps) => {
  const total = cart.reduce((sum, item) => sum + getItemTotal(item), 0);

  return (
    <div className="min-h-screen flex flex-col pb-28 max-w-[1200px] mx-auto">
      <div className="flex items-center gap-4 p-4 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-7 h-7" />
        </button>
        <h2 className="text-xl font-bold">Seu Pedido</h2>
      </div>

      {cart.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
          <span className="text-6xl">🛒</span>
          <p className="text-lg">Seu carrinho está vazio</p>
          <button onClick={onBack} className="touch-btn bg-primary text-primary-foreground px-8 py-3 rounded-xl">
            Ver Cardápio
          </button>
        </div>
      ) : (
        <div className="flex-1 p-4 space-y-3">
          {cart.map(item => (
            <div key={item.id} className="kiosk-card p-4 flex items-start gap-4">
              <span className="text-3xl">{item.product.image}</span>
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-sm">{item.quantity}x {item.product.name}</h4>
                {item.removedIngredients.length > 0 && (
                  <p className="text-xs text-secondary mt-1">
                    Sem: {item.removedIngredients.join(', ')}
                  </p>
                )}
                {item.selectedExtras.length > 0 && (
                  <p className="text-xs text-primary mt-1">
                    +{item.selectedExtras.map(e => e.name).join(', ')}
                  </p>
                )}
                <p className="text-primary font-bold mt-1">{formatCurrency(getItemTotal(item))}</p>
              </div>
              <button onClick={() => onRemove(item.id)} className="text-destructive hover:text-destructive/80 p-2">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4 space-y-3">
          <div className="flex justify-between text-lg font-bold">
            <span>Total</span>
            <span className="text-primary">{formatCurrency(total)}</span>
          </div>
          <button
            onClick={onCheckout}
            className="touch-btn w-full bg-primary text-primary-foreground py-4 rounded-xl text-lg"
          >
            Finalizar Pedido
          </button>
        </div>
      )}
    </div>
  );
};

export default CartScreen;
