import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2, Ticket, CheckCircle2, X, Loader2, Crown, Sparkles, CalendarClock, Clock } from 'lucide-react';
import { CartItem, getItemTotal, formatCurrency } from '@/data/store';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import LoyaltyCard from './LoyaltyCard';
import { useVisionPrimeConfig, useVisionPrimeStatus } from '@/hooks/useVisionPrime';
import { useStoreStatus } from '@/hooks/useStoreStatus';
import StoreStatusBadge from './StoreStatusBadge';

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
  onCheckout: (scheduledFor?: string | null) => void;
  onBack: () => void;
  isAuthenticated?: boolean;
  orgId: string | null;
  appliedCoupon: AppliedCoupon | null;
  onApplyCoupon: (c: AppliedCoupon | null) => void;
  deviceOwnedKiosk?: boolean;
}

const CartScreen = ({ cart, onRemove, onCheckout, onBack, isAuthenticated = false, orgId, appliedCoupon, onApplyCoupon, deviceOwnedKiosk = false }: CartScreenProps) => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const { config: primeCfg } = useVisionPrimeConfig(orgId, !deviceOwnedKiosk);
  const { status: primeStatus } = useVisionPrimeStatus(orgId, !deviceOwnedKiosk);

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
  const storeStatus = useStoreStatus(orgId);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledDate, setScheduledDate] = useState<string>('');
  const [scheduledTime, setScheduledTime] = useState<string>('');

  // Defaults para o agendamento = próximo horário de abertura
  useEffect(() => {
    if (storeStatus.nextOpenAt && !scheduledDate) {
      const d = storeStatus.nextOpenAt;
      const pad = (n: number) => String(n).padStart(2, '0');
      setScheduledDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      setScheduledTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
  }, [storeStatus.nextOpenAt]);

  useEffect(() => {
    if (deviceOwnedKiosk) {
      setCustomerPhone('');
      return;
    }
    let cancelled = false;
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || cancelled) return;
      const { data } = await supabase.from('profiles').select('phone').eq('user_id', user.id).maybeSingle();
      if (!cancelled && data?.phone) setCustomerPhone(data.phone);
    });
    return () => { cancelled = true; };
  }, [deviceOwnedKiosk]);

  const validateCoupon = async (code: string, successMessage: string) => {
    if (!orgId) return false;
    if (deviceOwnedKiosk && typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast.error('Cupom exige validação online. Nenhum desconto foi aplicado offline.');
      return false;
    }
    const { data, error } = await supabase.rpc('validate_checkout_coupon', {
      _organization_id: orgId, _codigo: code, _subtotal: subtotal,
    });
    const result: any = data;
    if (error) {
      const message = String(error.message || '');
      if (message.includes('coupon_rate_limited')) {
        toast.error('Muitas tentativas de cupom. Aguarde alguns minutos e tente novamente.');
      } else {
        toast.error('Não foi possível validar o cupom agora. Tente novamente.');
      }
      return false;
    }
    if (!result?.ok || !result?.cupom) {
      const reason = result?.reason;
      const messages: Record<string,string> = {
        expired: 'Este cupom já expirou.', not_started: 'Este cupom ainda não está ativo.',
        inactive: 'Este cupom está inativo.', minimum_not_met: 'O pedido não atingiu o valor mínimo deste cupom.',
      };
      toast.error(messages[reason] || 'Cupom inválido para esta loja.');
      return false;
    }
    const c = result.cupom;
    const percent = ['percentual','porcentagem','percent','percentage'].includes(String(c.tipo).toLowerCase());
    onApplyCoupon({ id: c.id, codigo: c.codigo, tipo: percent ? 'porcentagem' : 'valor_fixo', valor: Number(c.valor), discount: Number(c.discount) });
    toast.success(successMessage);
    return true;
  };

  // Auto-aplica cupom pendente vindo de notificação (sininho), sempre validado no servidor.
  useEffect(() => {
    if (!orgId || appliedCoupon || deviceOwnedKiosk) return;
    let pending = '';
    try { pending = localStorage.getItem('pending_coupon') || ''; } catch { /* ignore */ }
    if (!pending) return;
    try { localStorage.removeItem('pending_coupon'); } catch { /* ignore */ }
    const code = pending.trim().toUpperCase();
    validateCoupon(code, `Cupom ${code} aplicado da sua notificação!`);
  }, [orgId, appliedCoupon, deviceOwnedKiosk]);

  const applyCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code || !orgId) return;
    setValidating(true);
    try {
      const ok = await validateCoupon(code, 'Cupom aplicado com sucesso!');
      if (ok) setCouponCode('');
    } finally {
      setValidating(false);
    }
  };

  const removeCoupon = () => {
    onApplyCoupon(null);
    toast.info('Cupom removido.');
  };

  const goPrime = () => navigate(slug ? `/loja/${slug}/prime` : '/');
  const primeBadge = primeStatus.active && (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black text-black"
      style={{ background: 'linear-gradient(135deg,#f6c560,#d4881e)' }}>
      <Crown className="w-3 h-3" /> Prime {primeStatus.sinceYear ?? ''}
    </span>
  );

  return (
    <div className={`min-h-screen flex flex-col max-w-[1200px] mx-auto ${scheduleMode ? 'pb-[34rem]' : 'pb-72'}`}>
      <div className="flex items-center gap-4 p-4 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-7 h-7" />
        </button>
        <h2 className="text-xl font-bold">Seu Pedido</h2>
        {!deviceOwnedKiosk && primeBadge}
        <div className="ml-auto"><StoreStatusBadge orgId={orgId} compact /></div>
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
          {!deviceOwnedKiosk && <LoyaltyCard organizationId={orgId} customerPhone={customerPhone} />}

          {!deviceOwnedKiosk && primeCfg?.ativo && !primeStatus.active && (
            <button onClick={goPrime}
              className="w-full text-left rounded-xl p-3 border-2 flex items-center gap-3"
              style={{ borderColor: '#d4a04c', background: 'linear-gradient(135deg, rgba(246,197,96,0.12), rgba(212,136,30,0.08))' }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center text-black flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#f6c560,#d4881e)' }}>
                <Crown className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm" style={{ color: '#f4d28b' }}>Seja Vision Prime</p>
                <p className="text-[11px] text-muted-foreground">{primeCfg.desconto_percentual}% off automático + frete grátis</p>
              </div>
              <Sparkles className="w-4 h-4" style={{ color: '#d4a04c' }} />
            </button>
          )}

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
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border p-4 space-y-2 max-h-[72dvh] overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          {couponDiscount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-success">Cupom ({appliedCoupon?.codigo})</span>
              <span className="text-success font-semibold">- {formatCurrency(couponDiscount)}</span>
            </div>
          )}
          {primeDiscount > 0 && (
            <div className="flex justify-between text-sm">
              <span style={{ color: '#f4d28b' }} className="flex items-center gap-1"><Crown className="w-3 h-3" /> Vision Prime ({primeCfg?.desconto_percentual}%)</span>
              <span className="font-semibold" style={{ color: '#f4d28b' }}>- {formatCurrency(primeDiscount)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold pt-1 border-t border-border">
            <span>Total</span>
            <span className="text-primary">{formatCurrency(total)}</span>
          </div>
          {/* Status da loja → nunca concluir aberto/fechado antes da configuração terminar de carregar */}
          {storeStatus.loading ? (
            <button disabled className="touch-btn w-full bg-muted text-muted-foreground py-4 rounded-xl text-lg cursor-wait flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /> Verificando horário da loja…
            </button>
          ) : storeStatus.open ? (
            <button onClick={() => onCheckout(null)} className="touch-btn cta-breath w-full bg-primary text-primary-foreground py-4 rounded-xl text-lg">
              {deviceOwnedKiosk || isAuthenticated ? 'Finalizar Pedido' : 'Entrar para Finalizar Pedido'}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <p className="font-bold text-destructive flex items-center gap-2">
                  <Clock className="w-4 h-4" /> {storeStatus.message}
                </p>
                {storeStatus.nextOpenAt && !storeStatus.emergencyClosed && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Próxima abertura: {storeStatus.nextOpenAt.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>

              {storeStatus.schedulingEnabled && !storeStatus.emergencyClosed ? (
                !scheduleMode ? (
                  <button onClick={() => setScheduleMode(true)}
                    className="touch-btn w-full bg-primary text-primary-foreground py-4 rounded-xl text-lg flex items-center justify-center gap-2">
                    <CalendarClock className="w-5 h-5" /> Agendar Pedido
                  </button>
                ) : (
                  <div className="rounded-xl border border-primary/40 p-3 space-y-2 bg-primary/5">
                    <p className="text-sm font-bold flex items-center gap-2"><CalendarClock className="w-4 h-4 text-primary" /> Agendar para:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}
                        className="flex-1 px-3 py-2 bg-muted rounded-lg outline-none text-sm" />
                      <input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)}
                        className="w-28 px-3 py-2 bg-muted rounded-lg outline-none text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setScheduleMode(false)} className="touch-btn bg-muted px-3 py-2 rounded-lg text-sm flex-1">Cancelar</button>
                      <button
                        onClick={() => {
                          if (!scheduledDate || !scheduledTime) { toast.error('Escolha data e hora'); return; }
                          const iso = new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();
                          if (new Date(iso) <= new Date()) { toast.error('Escolha uma data futura'); return; }
                          onCheckout(iso);
                        }}
                        className="touch-btn bg-primary text-primary-foreground px-3 py-2 rounded-lg text-sm flex-[2] font-bold">
                        Confirmar Agendamento
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <button disabled className="touch-btn w-full bg-muted text-muted-foreground py-4 rounded-xl text-lg cursor-not-allowed">
                  Pedidos indisponíveis
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CartScreen;
