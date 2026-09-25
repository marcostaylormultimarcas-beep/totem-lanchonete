import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Award, Check, ChevronRight, Coins, Gift, History as HistoryIcon,
  LogIn, RotateCcw, ShoppingBag, Trophy, X,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/data/store';
import {
  fetchPublicLoyaltyConfig,
  PublicLoyaltyConfig,
  PublicLoyaltyReward,
} from '@/lib/publicLoyaltyConfig';

interface Props {
  organizationId: string | null;
  customerPhone?: string;
  className?: string;
  compact?: boolean;
}

interface Redemption {
  id: string;
  reward_id: string | null;
  premio_texto: string;
  premio_descricao: string;
  premio_imagem: string;
  codigo_resgate: string;
  points_spent: number;
  status: 'pendente' | 'utilizado';
  created_at: string;
  used_at: string | null;
}

interface LedgerEntry {
  id: string;
  entry_type: 'earn' | 'redeem' | 'reversal' | 'adjustment';
  points: number;
  balance_after: number;
  eligible_amount: number | null;
  description: string;
  created_at: string;
}

interface CustomerState {
  signedIn: boolean;
  balance: number;
  earnedTotal: number;
  spentTotal: number;
  catalog: PublicLoyaltyReward[];
  redemptions: Redemption[];
  history: LedgerEntry[];
}

const EMPTY_STATE: CustomerState = {
  signedIn: false,
  balance: 0,
  earnedTotal: 0,
  spentTotal: 0,
  catalog: [],
  redemptions: [],
  history: [],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && Number.isInteger(value)
  && value >= 0;

const isFiniteInteger = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && Number.isInteger(value);

const isNonNegativeFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 0;

const isValidTimestamp = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && Number.isFinite(Date.parse(value));

const parseCustomerState = (payload: unknown): CustomerState | null => {
  if (!isRecord(payload) || payload.ok !== true) return null;

  if (
    !isNonNegativeInteger(payload.points_balance)
    || !isNonNegativeInteger(payload.points_earned_total)
    || !isNonNegativeInteger(payload.points_spent_total)
    || !Array.isArray(payload.catalog)
    || !Array.isArray(payload.redemptions)
    || !Array.isArray(payload.history)
  ) {
    return null;
  }

  const catalog: PublicLoyaltyReward[] = [];
  for (const value of payload.catalog) {
    if (
      !isRecord(value)
      || typeof value.id !== 'string'
      || value.id.length === 0
      || typeof value.title !== 'string'
      || typeof value.description !== 'string'
      || typeof value.image_url !== 'string'
      || !isNonNegativeInteger(value.points_cost)
      || value.points_cost < 1
      || value.points_cost > 100000000
      || (value.reward_type !== 'benefit' && value.reward_type !== 'product')
      || !(value.product_id === null || typeof value.product_id === 'string')
    ) {
      return null;
    }

    catalog.push({
      id: value.id,
      title: value.title,
      description: value.description,
      image_url: value.image_url,
      points_cost: value.points_cost,
      reward_type: value.reward_type,
      product_id: value.product_id,
    });
  }

  const redemptions: Redemption[] = [];
  for (const value of payload.redemptions) {
    if (
      !isRecord(value)
      || typeof value.id !== 'string'
      || value.id.length === 0
      || !(value.reward_id === null || typeof value.reward_id === 'string')
      || typeof value.premio_texto !== 'string'
      || typeof value.premio_descricao !== 'string'
      || !(value.premio_imagem === null || typeof value.premio_imagem === 'string')
      || typeof value.codigo_resgate !== 'string'
      || !isNonNegativeInteger(value.points_spent)
      || (value.status !== 'pendente' && value.status !== 'utilizado')
      || !isValidTimestamp(value.created_at)
      || !(value.used_at === null || isValidTimestamp(value.used_at))
    ) {
      return null;
    }

    redemptions.push({
      id: value.id,
      reward_id: value.reward_id,
      premio_texto: value.premio_texto,
      premio_descricao: value.premio_descricao,
      premio_imagem: value.premio_imagem || '',
      codigo_resgate: value.codigo_resgate,
      points_spent: value.points_spent,
      status: value.status,
      created_at: value.created_at,
      used_at: value.used_at,
    });
  }

  const history: LedgerEntry[] = [];
  for (const value of payload.history) {
    if (
      !isRecord(value)
      || typeof value.id !== 'string'
      || value.id.length === 0
      || !['earn', 'redeem', 'reversal', 'adjustment'].includes(String(value.entry_type))
      || !isFiniteInteger(value.points)
      || value.points === 0
      || !isNonNegativeInteger(value.balance_after)
      || !(
        value.eligible_amount === null
        || isNonNegativeFiniteNumber(value.eligible_amount)
      )
      || typeof value.description !== 'string'
      || !isValidTimestamp(value.created_at)
    ) {
      return null;
    }

    history.push({
      id: value.id,
      entry_type: value.entry_type as LedgerEntry['entry_type'],
      points: value.points,
      balance_after: value.balance_after,
      eligible_amount: value.eligible_amount,
      description: value.description,
      created_at: value.created_at,
    });
  }

  return {
    signedIn: true,
    balance: payload.points_balance,
    earnedTotal: payload.points_earned_total,
    spentTotal: payload.points_spent_total,
    catalog,
    redemptions,
    history,
  };
};

const SEEN_KEY = (org: string) => `vf-loyalty-seen-v2:${org}`;

const LoyaltyCard = ({
  organizationId,
  className = '',
  compact = false,
}: Props) => {
  const location = useLocation();
  const [config, setConfig] = useState<PublicLoyaltyConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [state, setState] = useState<CustomerState>(EMPTY_STATE);
  const [stateLoading, setStateLoading] = useState(true);
  const [stateError, setStateError] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [prizeModal, setPrizeModal] = useState<Redemption | null>(null);
  const [hasSuccessfulState, setHasSuccessfulState] = useState(false);
  const walletRequestSeqRef = useRef(0);
  const walletOrgRef = useRef(organizationId);
  walletOrgRef.current = organizationId;

  useEffect(() => {
    if (!organizationId) {
      setConfig(null);
      setConfigLoading(false);
      setConfigError(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setConfigLoading(true);
      try {
        const data = await fetchPublicLoyaltyConfig(organizationId);
        if (!cancelled) {
          setConfig(data);
          setConfigError(false);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[loyalty] public config error:', error);
          setConfigError(true);
        }
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => { void load(); }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [organizationId]);

  const loadCustomerState = useCallback(async () => {
    const requestOrganizationId = organizationId;
    const requestId = ++walletRequestSeqRef.current;
    const isCurrentRequest = () =>
      walletRequestSeqRef.current === requestId
      && walletOrgRef.current === requestOrganizationId;

    if (!requestOrganizationId) {
      if (isCurrentRequest()) {
        setState(EMPTY_STATE);
        setStateError(false);
        setHasSuccessfulState(false);
        setStateLoading(false);
      }
      return;
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (authError) {
        if (!isCurrentRequest()) return;
        throw authError;
      }

      if (!authData.session) {
        if (!isCurrentRequest()) return;
        setState({ ...EMPTY_STATE, signedIn: false });
        setStateError(false);
        setHasSuccessfulState(false);
        return;
      }

      const { data, error } = await supabase.rpc('loyalty_customer_state' as any, {
        _organization_id: requestOrganizationId,
      });
      if (!isCurrentRequest()) return;
      if (error) throw error;

      const nextState = parseCustomerState(data);
      if (!nextState) throw new Error('loyalty_state_invalid');

      setState(nextState);
      setStateError(false);
      setHasSuccessfulState(true);

      const seen = (() => {
        try { return JSON.parse(localStorage.getItem(SEEN_KEY(requestOrganizationId)) || '[]') as string[]; }
        catch { return []; }
      })();
      const fresh = nextState.redemptions.find(
        redemption => redemption.status === 'pendente' && !seen.includes(redemption.id),
      );
      if (fresh) setPrizeModal(current => current || fresh);
    } catch (error) {
      if (!isCurrentRequest()) return;
      console.error('[loyalty] customer state error:', error);
      setStateError(true);
    } finally {
      if (isCurrentRequest()) setStateLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    walletRequestSeqRef.current += 1;
    setState(EMPTY_STATE);
    setStateError(false);
    setHasSuccessfulState(false);
    setPrizeModal(null);
    setStateLoading(Boolean(organizationId));

    if (!organizationId) return;

    void loadCustomerState();
    const timer = window.setInterval(() => { void loadCustomerState(); }, 15000);
    const onFocus = () => { void loadCustomerState(); };
    window.addEventListener('focus', onFocus);
    return () => {
      walletRequestSeqRef.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [organizationId, loadCustomerState]);

  const catalog = useMemo(() => {
    const source = state.catalog.length > 0 ? state.catalog : (config?.rewards || []);
    return [...source].sort((a, b) => a.points_cost - b.points_cost);
  }, [state.catalog, config?.rewards]);

  const availableBalance = state.balance;
  const affordable = [...catalog].reverse().find(reward => reward.points_cost <= availableBalance) || null;
  const nextLocked = catalog.find(reward => reward.points_cost > availableBalance) || null;
  const target = nextLocked || catalog[catalog.length - 1] || null;
  const progress = target ? Math.min(100, Math.round((availableBalance / target.points_cost) * 100)) : 0;
  const pendingCount = state.redemptions.filter(r => r.status === 'pendente').length;

  const ruleText = config?.earning_mode === 'order'
    ? `${config.points_per_order} ponto${config.points_per_order === 1 ? '' : 's'} por pedido elegível`
    : `R$ 1 = ${config?.points_per_real || 1} ponto${Number(config?.points_per_real || 1) === 1 ? '' : 's'}`;

  const dismissPrize = () => {
    if (prizeModal && organizationId) {
      try {
        const key = SEEN_KEY(organizationId);
        const seen = JSON.parse(localStorage.getItem(key) || '[]') as string[];
        if (!seen.includes(prizeModal.id)) {
          seen.push(prizeModal.id);
          localStorage.setItem(key, JSON.stringify(seen.slice(-100)));
        }
      } catch { /* storage is optional */ }
    }
    setPrizeModal(null);
  };

  const redeem = async (reward: PublicLoyaltyReward) => {
    if (!organizationId || redeeming) return;
    if (!state.signedIn) return;
    if (availableBalance < reward.points_cost) return;

    const confirmed = window.confirm(
      `Resgatar "${reward.title}" por ${reward.points_cost} pontos?`,
    );
    if (!confirmed) return;

    setRedeeming(reward.id);
    try {
      const { data, error } = await supabase.rpc('loyalty_redeem_reward' as any, {
        _organization_id: organizationId,
        _reward_id: reward.id,
      });
      const result = data as any;
      if (error || !result?.ok) {
        const messages: Record<string, string> = {
          insufficient_points: 'Seu saldo mudou e não há pontos suficientes para este prêmio.',
          wallet_not_found: 'Faça ao menos um pedido elegível antes de resgatar.',
          identity_conflict: 'Não foi possível vincular sua fidelidade com segurança. Fale com a loja.',
          reward_not_found: 'Este prêmio não está mais disponível.',
          inactive: 'O programa de fidelidade está temporariamente inativo.',
          expired: 'Esta campanha de fidelidade terminou.',
          not_started: 'Esta campanha ainda não começou.',
        };
        throw new Error(messages[result?.reason] || error?.message || 'Não foi possível resgatar agora.');
      }

      const prize = result.reward || {};
      setPrizeModal({
        id: String(result.redemption_id || ''),
        reward_id: reward.id,
        premio_texto: String(prize.title || reward.title),
        premio_descricao: String(prize.description || reward.description || ''),
        premio_imagem: String(prize.image_url || reward.image_url || ''),
        codigo_resgate: String(result.code || ''),
        points_spent: Number(result.points_spent) || reward.points_cost,
        status: 'pendente',
        created_at: new Date().toISOString(),
        used_at: null,
      });
      await loadCustomerState();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível resgatar agora.';
      window.alert(message);
    } finally {
      setRedeeming(null);
    }
  };

  if (configLoading && !config) {
    return (
      <div className={`rounded-2xl border border-primary/20 bg-card/70 p-4 ${className}`}>
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="mt-3 h-10 rounded-xl bg-muted/70 animate-pulse" />
      </div>
    );
  }

  if (configError && !config) {
    return (
      <div className={`rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground ${className}`}>
        Fidelidade temporariamente indisponível. Tentaremos carregar novamente.
      </div>
    );
  }

  if (!config?.ativo) return null;

  if (stateLoading) {
    return (
      <div className={`rounded-2xl border border-primary/20 bg-card/70 p-4 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 animate-pulse" />
          <div className="flex-1">
            <div className="h-3 w-28 rounded bg-muted animate-pulse" />
            <div className="mt-2 h-6 w-36 rounded bg-muted/70 animate-pulse" />
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">Sincronizando sua fidelidade…</p>
      </div>
    );
  }

  if (stateError && !hasSuccessfulState) {
    return (
      <div className={`rounded-2xl border border-border bg-card p-4 ${className}`}>
        <p className="text-sm font-bold">Não foi possível carregar sua fidelidade</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Seus pontos não foram alterados. Tente novamente em alguns instantes.
        </p>
        <button
          type="button"
          onClick={() => {
            setStateError(false);
            setStateLoading(true);
            void loadCustomerState();
          }}
          className="mt-3 min-h-10 rounded-xl border border-border bg-muted/50 px-4 text-xs font-bold"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!state.signedIn) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return (
      <div className={`relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-card via-card to-primary/10 p-4 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Award className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-wider text-primary font-bold">Minha Fidelidade</p>
            <p className="text-sm font-bold">Ganhe pontos em seus pedidos</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{ruleText}</p>
          </div>
        </div>

        {catalog.length > 0 && (
          <div className="mt-3 text-xs text-muted-foreground">
            Primeiro prêmio: <b className="text-foreground">{catalog[0].title}</b> por{' '}
            <b className="text-primary">{catalog[0].points_cost} pts</b>
          </div>
        )}

        <Link
          to={`/auth?returnTo=${returnTo}`}
          className="mt-3 w-full min-h-11 rounded-xl bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2"
        >
          <LogIn className="w-4 h-4" /> Entrar para ver meus pontos
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className={`relative overflow-hidden rounded-2xl border border-primary/40 bg-gradient-to-br from-card via-card to-primary/10 p-4 sm:p-5 shadow-[0_8px_30px_-12px_hsl(var(--primary)/0.5)] ${className}`}>
        <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-primary/20 blur-2xl pointer-events-none" />

        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Coins className="w-6 h-6 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-primary font-bold">Minha Fidelidade</div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-foreground">{availableBalance}</span>
                <span className="text-sm font-bold text-primary">pontos</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setHistoryOpen(true)}
            className="relative min-h-10 px-3 rounded-xl bg-primary/10 border border-primary/20 text-primary text-xs font-bold flex items-center gap-1.5"
          >
            <HistoryIcon className="w-4 h-4" />
            Histórico
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-accent text-accent-foreground rounded-full text-[10px] flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
        </div>

        <div className="relative mt-4 rounded-xl border border-border/70 bg-background/45 p-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{ruleText}</span>
            {config.valor_minimo_pedido > 0 && (
              <span className="text-muted-foreground whitespace-nowrap">
                mín. {formatCurrency(config.valor_minimo_pedido)}
              </span>
            )}
          </div>

          {target && (
            <>
              <div className="mt-3 h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                {affordable ? (
                  <p className="text-xs text-success font-semibold">
                    🎁 Você já pode resgatar {affordable.title}.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Faltam <b className="text-primary">{Math.max(0, target.points_cost - availableBalance)} pts</b> para {target.title}.
                  </p>
                )}
                <span className="text-[11px] font-bold text-muted-foreground whitespace-nowrap">
                  {availableBalance}/{target.points_cost}
                </span>
              </div>
            </>
          )}

          {!target && (
            <p className="mt-2 text-xs text-muted-foreground">
              A loja ainda não cadastrou recompensas. Seus pontos continuam sendo acumulados normalmente.
            </p>
          )}
        </div>

        {!compact && (
          <div className="relative mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-background/40 border border-border/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Acumulados</div>
              <div className="font-black text-sm">{state.earnedTotal} pts</div>
            </div>
            <div className="rounded-xl bg-background/40 border border-border/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Resgatados</div>
              <div className="font-black text-sm">{state.spentTotal} pts</div>
            </div>
          </div>
        )}

        {stateError && hasSuccessfulState && (
          <p className="relative mt-3 text-xs text-amber-400">
            Não foi possível atualizar o saldo agora. Mostrando a última informação disponível.
          </p>
        )}

        <button
          onClick={() => setCatalogOpen(open => !open)}
          className="relative mt-4 w-full min-h-11 rounded-xl border border-primary/30 bg-primary/10 text-primary font-bold text-sm flex items-center justify-center gap-2"
        >
          <Gift className="w-4 h-4" />
          {catalogOpen ? 'Fechar recompensas' : 'Ver recompensas'}
          <ChevronRight className={`w-4 h-4 transition-transform ${catalogOpen ? 'rotate-90' : ''}`} />
        </button>

        {catalogOpen && (
          <div className="relative mt-3 space-y-2">
            {catalog.length === 0 ? (
              <div className="rounded-xl border border-border p-4 text-center text-sm text-muted-foreground">
                Nenhuma recompensa disponível no momento.
              </div>
            ) : catalog.map(reward => {
              const canRedeem = availableBalance >= reward.points_cost;
              return (
                <div key={reward.id} className="rounded-xl border border-border bg-background/55 p-3 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {reward.image_url
                      ? <img src={reward.image_url} alt={reward.title} className="w-full h-full object-cover" />
                      : <Trophy className="w-5 h-5 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{reward.title}</p>
                    {reward.description && <p className="text-[11px] text-muted-foreground line-clamp-2">{reward.description}</p>}
                    <p className="text-xs text-primary font-black mt-1">{reward.points_cost} pts</p>
                  </div>
                  <button
                    onClick={() => { void redeem(reward); }}
                    disabled={!canRedeem || Boolean(redeeming)}
                    className="px-3 min-h-9 rounded-lg bg-primary text-primary-foreground text-xs font-bold disabled:opacity-40"
                  >
                    {redeeming === reward.id ? 'Resgatando…' : canRedeem ? 'Resgatar' : `Faltam ${reward.points_cost - availableBalance}`}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {state.signedIn && state.history.length === 0 && !stateLoading && (
          <div className="relative mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <ShoppingBag className="w-4 h-4" />
            Faça um pedido elegível. Os pontos entram após pagamento confirmado e entrega/retirada.
          </div>
        )}
      </div>

      {prizeModal && (
        <div className="fixed inset-0 z-[80] bg-background/85 backdrop-blur-sm flex items-center justify-center p-4" onClick={dismissPrize}>
          <div
            className="relative bg-card border border-primary/40 rounded-3xl max-w-sm w-full overflow-hidden shadow-[0_30px_80px_-20px_hsl(var(--primary)/0.6)]"
            onClick={event => event.stopPropagation()}
          >
            <button onClick={dismissPrize} className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-background/85 flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
            {prizeModal.premio_imagem ? (
              <img src={prizeModal.premio_imagem} alt={prizeModal.premio_texto} className="w-full h-52 object-cover" />
            ) : (
              <div className="w-full h-44 bg-gradient-to-br from-primary/30 via-primary/10 to-background flex items-center justify-center">
                <Trophy className="w-20 h-20 text-primary" />
              </div>
            )}
            <div className="p-6 text-center space-y-3">
              <div className="text-xs uppercase tracking-widest text-primary font-black">🎉 Prêmio reservado</div>
              <h3 className="text-xl font-black">{prizeModal.premio_texto}</h3>
              {prizeModal.premio_descricao && (
                <p className="text-sm text-muted-foreground">{prizeModal.premio_descricao}</p>
              )}
              <div className="rounded-xl bg-primary/10 border border-primary/30 p-4">
                <p className="text-[11px] text-muted-foreground">Mostre este código à loja para receber o prêmio</p>
                <p className="text-2xl font-mono font-black text-primary tracking-[0.16em] mt-1">{prizeModal.codigo_resgate}</p>
              </div>
              {prizeModal.points_spent > 0 && (
                <p className="text-xs text-muted-foreground">−{prizeModal.points_spent} pontos</p>
              )}
              <button onClick={dismissPrize} className="w-full min-h-11 rounded-xl bg-primary text-primary-foreground font-bold">
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="fixed inset-0 z-[75] bg-background/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setHistoryOpen(false)}>
          <div
            className="bg-card border border-border rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[82vh] overflow-hidden flex flex-col"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="font-black flex items-center gap-2">
                  <HistoryIcon className="w-4 h-4 text-primary" /> Minha Fidelidade
                </h3>
                <p className="text-xs text-muted-foreground">{availableBalance} pontos disponíveis</p>
              </div>
              <button onClick={() => setHistoryOpen(false)} className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-5">
              <section>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2">Meus prêmios</h4>
                {state.redemptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground rounded-xl border border-border p-4 text-center">Nenhum prêmio resgatado ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {state.redemptions.map(redemption => (
                      <button
                        key={redemption.id}
                        onClick={() => redemption.status === 'pendente' && setPrizeModal(redemption)}
                        className="w-full text-left rounded-xl border border-border p-3 flex items-center gap-3 disabled:cursor-default"
                        disabled={redemption.status !== 'pendente'}
                      >
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                          {redemption.premio_imagem
                            ? <img src={redemption.premio_imagem} alt="" className="w-full h-full object-cover" />
                            : <Gift className="w-4 h-4 text-primary" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate">{redemption.premio_texto}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {redemption.points_spent > 0 ? `${redemption.points_spent} pts · ` : ''}
                            {new Date(redemption.created_at).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                        {redemption.status === 'pendente'
                          ? <span className="text-[10px] font-bold text-primary">VER CÓDIGO</span>
                          : <span className="text-[10px] font-bold text-success flex items-center gap-1"><Check className="w-3 h-3" />USADO</span>}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2">Movimentações</h4>
                {state.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground rounded-xl border border-border p-4 text-center">Seu histórico aparecerá aqui após o primeiro pedido elegível.</p>
                ) : (
                  <div className="space-y-2">
                    {state.history.map(entry => {
                      const positive = entry.points > 0;
                      const icon = entry.entry_type === 'reversal' ? RotateCcw : entry.entry_type === 'redeem' ? Gift : Coins;
                      const EntryIcon = icon;
                      return (
                        <div key={entry.id} className="rounded-xl border border-border p-3 flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                            <EntryIcon className={`w-4 h-4 ${positive ? 'text-success' : 'text-primary'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{entry.description || 'Movimentação de pontos'}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(entry.created_at).toLocaleString('pt-BR')}
                              {entry.eligible_amount != null ? ` · base ${formatCurrency(entry.eligible_amount)}` : ''}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`text-sm font-black ${positive ? 'text-success' : 'text-destructive'}`}>
                              {positive ? '+' : ''}{entry.points} pts
                            </p>
                            <p className="text-[10px] text-muted-foreground">saldo {entry.balance_after}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LoyaltyCard;
