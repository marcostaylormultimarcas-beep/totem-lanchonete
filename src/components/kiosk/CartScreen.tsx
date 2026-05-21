import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2, Ticket, CheckCircle2, X, Loader2, Crown, Sparkles } from 'lucide-react';
import { CartItem, getItemTotal, formatCurrency } from '@/data/store';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import LoyaltyCard from './LoyaltyCard';
import { useVisionPrimeConfig, useVisionPrimeStatus } from '@/hooks/useVisionPrime';

export interface AppliedCoupon {
  id: string;
  codigo: string;
  tipo: 'porcentagem' | 'valor_fixo';
  valor: number;
  discount: number;
}

interface CartScreenProps {
  cart: CartItem[];
  onRemove: (id: string) => void;
  onCheckout: () => void;
  onBack: () => void;
  isAuthenticated?: boolean;
  orgId: string | null;
  appliedCoupon: AppliedCoupon | null;
  onApplyCoupon: (c: AppliedCoupon | null) => void;
}

const CartScreen = ({ cart, onRemove, onCheckout, onBack, isAuthenticated = false, orgId, appliedCoupon, onApplyCoupon }: CartScreenProps) => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const { config: primeCfg } = useVisionPrimeConfig(orgId);
  const { status: primeStatus } = useVisionPrimeStatus(orgId);

  const subtotal = cart.reduce((sum, item) => sum + getItemTotal(item), 0);
  const couponDiscount = appliedCoupon ? Math.min(appliedCoupon.discount, subtotal) : 0;
  const primeDiscount = (primeStatus.active && primeCfg?.ativo)
    ? +(subtotal * (Number(primeCfg.desconto_percentual) || 0) / 100).toFixed(2)
    : 0;
  const discount = Math.min(subtotal, couponDiscount + primeDiscount);
  const total = Math.max(0, subtotal - discount);
  const isImageUrl = (value: string) => value.startsWith('http') || value.startsWith('/');

  const [couponCode, setCouponCode] = useState('');
  const [validating, setValidating] = useState(false);
  const [customerPhone, setCustomerPhone] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || cancelled) return;
      const { data } = await supabase.from('profiles').select('phone').eq('user_id', user.id).maybeSingle();
      if (!cancelled && data?.phone) setCustomerPhone(data.phone);
    });
    return () => { cancelled = true; };
  }, []);

  const applyCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code || !orgId) return;
    setValidating(true);
    const { data, error } = await supabase
      .from('cupons' as any)
      .select('*')
      .eq('organization_id', orgId)
      .eq('codigo', code)
      .eq('status', 'ativo')
      .maybeSingle();
    setValidating(false);
    if (error || !data) {
      toast.error('Cupom inválido para esta loja.');
      return;
    }
    const c: any = data;
    const now = new Date();
    if (c.data_inicio && now < new Date(c.data_inicio)) {
      toast.error('Este cupom ainda não está ativo.');
      return;
    }
    if (c.data_fim && now > new Date(c.data_fim)) {
      toast.error('Este cupom já expirou.');
      return;
    }
    const calc = c.tipo === 'porcentagem' ? (subtotal * Number(c.valor)) / 100 : Number(c.valor);
    onApplyCoupon({ id: c.id, codigo: c.codigo, tipo: c.tipo, valor: Number(c.valor), discount: calc });
    setCouponCode('');
    toast.success('Cupom aplicado com sucesso!');
  };

  const removeCoupon = () => {
    onApplyCoupon(null);
    toast.info('Cupom removido.');
  };

  return (
    <div className="min-h-screen flex flex-col pb-40 max-w-[1200px] mx-auto">
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
          <LoyaltyCard organizationId={orgId} customerPhone={customerPhone} />
          {cart.map(item => (
            <div key={item.id} className="kiosk-card p-4 flex items-start gap-4">
              {isImageUrl(item.product.image) ? (
                <img src={item.product.image} alt={item.product.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
              ) : (
                <span className="text-3xl w-16 h-16 flex items-center justify-center flex-shrink-0">{item.product.image}</span>
              )}
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-sm">{item.quantity}x {item.product.name}</h4>
                {item.removedIngredients.length > 0 && (
                  <p className="text-xs text-secondary mt-1">Sem: {item.removedIngredients.join(', ')}</p>
                )}
                {item.selectedExtras.length > 0 && (
                  <p className="text-xs text-primary mt-1">+{item.selectedExtras.map(e => e.name).join(', ')}</p>
                )}
                <p className="text-primary font-bold mt-1">{formatCurrency(getItemTotal(item))}</p>
              </div>
              <button onClick={() => onRemove(item.id)} className="text-destructive hover:text-destructive/80 p-2">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          ))}

          {/* Coupon area */}
          <div className="kiosk-card p-4 space-y-3">
            <p className="text-sm font-semibold flex items-center gap-2">
              <Ticket className="w-4 h-4 text-primary" /> Possui um cupom de desconto?
            </p>
            {appliedCoupon ? (
              <div className="flex items-center justify-between bg-success/10 border border-success/30 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-success" />
                  <span className="font-bold text-sm">{appliedCoupon.codigo}</span>
                  <span className="text-xs text-muted-foreground">
                    ({appliedCoupon.tipo === 'porcentagem' ? `${appliedCoupon.valor}%` : formatCurrency(appliedCoupon.valor)})
                  </span>
                </div>
                <button onClick={removeCoupon} className="p-1 text-muted-foreground hover:text-destructive">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-2 w-full max-w-full">
                <input
                  value={couponCode}
                  onChange={e => setCouponCode(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && applyCoupon()}
                  placeholder="DIGITE SEU CUPOM"
                  className="w-full sm:flex-1 min-w-0 px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary uppercase text-sm"
                  maxLength={30}
                />
                <button onClick={applyCoupon} disabled={validating || !couponCode.trim()}
                  className="touch-btn w-full sm:w-auto bg-primary text-primary-foreground px-5 py-3 rounded-lg text-sm disabled:opacity-50 flex items-center justify-center gap-2 shrink-0">
                  {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-success">Desconto ({appliedCoupon?.codigo})</span>
              <span className="text-success font-semibold">- {formatCurrency(discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold pt-1 border-t border-border">
            <span>Total</span>
            <span className="text-primary">{formatCurrency(total)}</span>
          </div>
          <button onClick={onCheckout} className="touch-btn cta-breath w-full bg-primary text-primary-foreground py-4 rounded-xl text-lg">
            {isAuthenticated ? 'Finalizar Pedido' : 'Entrar para Finalizar Pedido'}
          </button>
        </div>
      )}
    </div>
  );
};

export default CartScreen;
