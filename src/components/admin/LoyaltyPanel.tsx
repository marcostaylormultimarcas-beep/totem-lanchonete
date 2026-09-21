import { useEffect, useMemo, useState } from 'react';
import {
  Award, Calendar, Check, Coins, Gift, History, Image as ImageIcon,
  Loader2, Package, Pencil, Plus, RotateCcw, Save, Trash2, Upload, Users, WalletCards,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { uploadProductImage, StorageLimitError } from '@/lib/imageUpload';
import { formatCurrency } from '@/data/store';

interface Config {
  id?: string;
  ativo: boolean;
  earning_mode: 'spend' | 'order';
  points_per_real: number;
  points_per_order: number;
  valor_minimo_pedido: number;
  valido_de: string;
  valido_ate: string;
}

interface Reward {
  id: string;
  title: string;
  description: string;
  image_url: string;
  points_cost: number;
  reward_type: 'benefit' | 'product';
  product_id: string | null;
  estimated_cost: number | null;
  active: boolean;
  sort_order: number;
}

interface RewardForm {
  id?: string;
  title: string;
  description: string;
  image_url: string;
  points_cost: number;
  product_id: string;
  active: boolean;
}

interface ProductOption {
  id: string;
  name: string;
  price: number;
  cost_price: number | null;
}

interface Resgate {
  id: string;
  telefone_cliente: string;
  premio_texto: string;
  premio_descricao?: string;
  premio_imagem: string;
  codigo_resgate: string;
  points_spent?: number;
  status: 'pendente' | 'utilizado';
  created_at: string;
  used_at: string | null;
}

interface Summary {
  active_customers: number;
  points_issued: number;
  points_reversed: number;
  points_spent: number;
  outstanding_points: number;
  pending_rewards: number;
}

const DEFAULT_CONFIG: Config = {
  ativo: false,
  earning_mode: 'spend',
  points_per_real: 1,
  points_per_order: 1,
  valor_minimo_pedido: 0,
  valido_de: '',
  valido_ate: '',
};

const DEFAULT_REWARD: RewardForm = {
  title: '',
  description: '',
  image_url: '',
  points_cost: 100,
  product_id: '',
  active: true,
};

const EMPTY_SUMMARY: Summary = {
  active_customers: 0,
  points_issued: 0,
  points_reversed: 0,
  points_spent: 0,
  outstanding_points: 0,
  pending_rewards: 0,
};

const formatPhone = (value: string) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits || 'Cliente';
};

const LoyaltyPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [resgates, setResgates] = useState<Resgate[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [rewardForm, setRewardForm] = useState<RewardForm>(DEFAULT_REWARD);
  const [showRewardForm, setShowRewardForm] = useState(false);
  const [filter, setFilter] = useState<'pendente' | 'todos'>('pendente');
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingReward, setSavingReward] = useState(false);
  const [uploadingReward, setUploadingReward] = useState(false);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);

  const fetchAll = async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const [cfgResult, rewardsResult, resgatesResult, productsResult, summaryResult] = await Promise.all([
        supabase.from('config_fidelidade' as any).select('*').eq('organization_id', organizationId).maybeSingle(),
        supabase.from('loyalty_rewards' as any).select('*').eq('organization_id', organizationId).order('points_cost', { ascending: true }),
        supabase.from('resgates_fidelidade').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(100),
        supabase.from('products').select('id,name,price,cost_price').eq('organization_id', organizationId).eq('available', true).order('name'),
        supabase.rpc('loyalty_admin_summary' as any, { _organization_id: organizationId }),
      ]);

      if (cfgResult.error) throw cfgResult.error;
      if (rewardsResult.error) throw rewardsResult.error;
      if (resgatesResult.error) throw resgatesResult.error;
      if (productsResult.error) throw productsResult.error;

      const row = cfgResult.data;
      if (row) {
        setConfig({
          id: row.id,
          ativo: Boolean(row.ativo),
          earning_mode: row.earning_mode === 'order' ? 'order' : 'spend',
          points_per_real: Math.max(0.01, Number(row.points_per_real) || 1),
          points_per_order: Math.max(1, Number(row.points_per_order) || 1),
          valor_minimo_pedido: Math.max(0, Number(row.valor_minimo_pedido) || 0),
          valido_de: row.data_inicio ? row.data_inicio.slice(0, 10) : '',
          valido_ate: row.data_fim ? row.data_fim.slice(0, 10) : '',
        });
      } else {
        setConfig(DEFAULT_CONFIG);
      }

      setRewards((rewardsResult.data || []).map(row => ({
        id: row.id,
        title: row.title,
        description: row.description || '',
        image_url: row.image_url || '',
        points_cost: Number(row.points_cost) || 1,
        reward_type: row.reward_type === 'product' ? 'product' : 'benefit',
        product_id: row.product_id,
        estimated_cost: row.estimated_cost == null ? null : Number(row.estimated_cost),
        active: Boolean(row.active),
        sort_order: Number(row.sort_order) || 0,
      })));
      setResgates((resgatesResult.data || []) as Resgate[]);
      setProducts((productsResult.data || []).map(product => ({
        id: product.id,
        name: product.name,
        price: Number(product.price) || 0,
        cost_price: product.cost_price == null ? null : Number(product.cost_price),
      })));

      const stats = summaryResult.data as any;
      if (!summaryResult.error && stats?.ok) {
        setSummary({
          active_customers: Number(stats.active_customers) || 0,
          points_issued: Number(stats.points_issued) || 0,
          points_reversed: Number(stats.points_reversed) || 0,
          points_spent: Number(stats.points_spent) || 0,
          outstanding_points: Number(stats.outstanding_points) || 0,
          pending_rewards: Number(stats.pending_rewards) || 0,
        });
      }
    } catch (error) {
      console.error('[LoyaltyPanel] load error', error);
      toast.error('Não foi possível carregar a fidelidade.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAll();
    if (!organizationId) return;

    const channel = supabase
      .channel(`admin-loyalty-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resgates_fidelidade', filter: `organization_id=eq.${organizationId}` }, () => { void fetchAll(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loyalty_points_ledger', filter: `organization_id=eq.${organizationId}` }, () => { void fetchAll(); })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [organizationId]);

  const saveConfig = async () => {
    if (!organizationId) return;
    if (config.points_per_real <= 0 || config.points_per_real > 1000) {
      toast.error('Pontos por R$ 1 deve ser maior que zero e no máximo 1.000.');
      return;
    }
    if (config.points_per_order < 1) {
      toast.error('Pontos por pedido deve ser ao menos 1.');
      return;
    }
    if (config.valor_minimo_pedido < 0) {
      toast.error('O valor mínimo não pode ser negativo.');
      return;
    }
    if (config.valido_de && config.valido_ate && config.valido_de > config.valido_ate) {
      toast.error('A data final deve ser posterior à data inicial.');
      return;
    }

    setSavingConfig(true);
    try {
      const payload = {
        organization_id: organizationId,
        ativo: config.ativo,
        earning_mode: config.earning_mode,
        points_per_real: config.points_per_real,
        points_per_order: Math.max(1, Math.trunc(config.points_per_order)),
        valor_minimo_pedido: config.valor_minimo_pedido,
        data_inicio: config.valido_de ? `${config.valido_de}T00:00:00.000Z` : null,
        data_fim: config.valido_ate ? `${config.valido_ate}T23:59:59.999Z` : null,
      };

      const { data, error } = await supabase
        .from('config_fidelidade')
        .upsert(payload, { onConflict: 'organization_id' })
        .select('id')
        .maybeSingle();
      if (error) throw error;

      setConfig(current => ({ ...current, id: data?.id || current.id }));
      toast.success('Regras de pontos salvas.');
      await fetchAll();
    } catch (error) {
      console.error('[LoyaltyPanel] config save error', error);
      toast.error('Não foi possível salvar as regras de fidelidade.');
    } finally {
      setSavingConfig(false);
    }
  };

  const selectedProduct = useMemo(
    () => products.find(product => product.id === rewardForm.product_id) || null,
    [products, rewardForm.product_id],
  );

  const equivalentSpend = useMemo(() => {
    if (config.earning_mode !== 'spend' || config.points_per_real <= 0) return null;
    return rewardForm.points_cost / config.points_per_real;
  }, [config.earning_mode, config.points_per_real, rewardForm.points_cost]);

  const resetRewardForm = () => {
    setRewardForm(DEFAULT_REWARD);
    setShowRewardForm(false);
  };

  const editReward = (reward: Reward) => {
    setRewardForm({
      id: reward.id,
      title: reward.title,
      description: reward.description,
      image_url: reward.image_url,
      points_cost: reward.points_cost,
      product_id: reward.product_id || '',
      active: reward.active,
    });
    setShowRewardForm(true);
  };

  const selectRewardProduct = (productId: string) => {
    const product = products.find(item => item.id === productId);
    setRewardForm(current => ({
      ...current,
      product_id: productId,
      title: current.title || product?.name || '',
    }));
  };

  const uploadRewardImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !organizationId) return;
    setUploadingReward(true);
    try {
      const url = await uploadProductImage(file, organizationId);
      setRewardForm(current => ({ ...current, image_url: url }));
      toast.success('Imagem enviada. Salve a recompensa para confirmar.');
    } catch (error) {
      toast.error(error instanceof StorageLimitError ? error.message : 'Erro ao enviar imagem.');
    } finally {
      setUploadingReward(false);
    }
  };

  const saveReward = async () => {
    if (!organizationId) return;
    const title = rewardForm.title.trim();
    if (!title) {
      toast.error('Informe o nome da recompensa.');
      return;
    }
    if (!Number.isFinite(rewardForm.points_cost) || rewardForm.points_cost < 1) {
      toast.error('Informe um custo em pontos maior que zero.');
      return;
    }

    const product = products.find(item => item.id === rewardForm.product_id);
    const payload = {
      organization_id: organizationId,
      title,
      description: rewardForm.description.trim(),
      image_url: rewardForm.image_url,
      points_cost: Math.trunc(rewardForm.points_cost),
      reward_type: product ? 'product' : 'benefit',
      product_id: product?.id || null,
      estimated_cost: product?.cost_price ?? null,
      active: rewardForm.active,
    };

    setSavingReward(true);
    try {
      if (rewardForm.id) {
        const { error } = await supabase
          .from('loyalty_rewards' as any)
          .update(payload)
          .eq('id', rewardForm.id)
          .eq('organization_id', organizationId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('loyalty_rewards' as any).insert(payload);
        if (error) throw error;
      }

      toast.success(rewardForm.id ? 'Recompensa atualizada.' : 'Recompensa criada.');
      resetRewardForm();
      await fetchAll();
    } catch (error) {
      console.error('[LoyaltyPanel] reward save error', error);
      toast.error('Não foi possível salvar a recompensa.');
    } finally {
      setSavingReward(false);
    }
  };

  const removeReward = async (reward: Reward) => {
    if (!organizationId || !window.confirm(`Excluir a recompensa "${reward.title}"?`)) return;
    const { error } = await supabase
      .from('loyalty_rewards' as any)
      .delete()
      .eq('id', reward.id)
      .eq('organization_id', organizationId);
    if (error) {
      toast.error('Não foi possível excluir a recompensa.');
      return;
    }
    toast.success('Recompensa excluída.');
    await fetchAll();
  };

  const redeem = async (id: string) => {
    if (!window.confirm('Confirmar que este prêmio foi entregue ao cliente?')) return;
    setRedeemingId(id);
    try {
      const { data, error } = await supabase.rpc('redeem_loyalty_prize', { _resgate_id: id });
      const result = data as any;
      if (error || !result?.ok) throw error || new Error(result?.reason || 'redeem_failed');
      toast.success('Prêmio marcado como utilizado.');
      await fetchAll();
    } catch (error) {
      console.error('[LoyaltyPanel] redemption error', error);
      toast.error('Não foi possível concluir a entrega do prêmio.');
    } finally {
      setRedeemingId(null);
    }
  };

  const filteredRedemptions = filter === 'pendente'
    ? resgates.filter(item => item.status === 'pendente')
    : resgates;

  if (!organizationId) {
    return <div className="p-4 text-muted-foreground">Selecione uma loja.</div>;
  }

  if (loading && !config.id && rewards.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" /> Carregando fidelidade…
      </div>
    );
  }

  return (
    <div className="px-4 space-y-5">
      <section className="bg-card border border-border rounded-2xl p-5 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Coins className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-black">Programa de Pontos</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Pontos entram somente após pagamento confirmado + pedido entregue/retirado. Descontos não pontuam e a taxa de entrega não entra na base.
            </p>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 bg-muted/40 rounded-xl px-4 py-3 cursor-pointer">
          <div>
            <p className="text-sm font-bold">Programa ativo</p>
            <p className="text-xs text-muted-foreground">Quando ativo, clientes veem saldo, regras e recompensas.</p>
          </div>
          <input
            type="checkbox"
            checked={config.ativo}
            onChange={event => setConfig(current => ({ ...current, ativo: event.target.checked }))}
            className="w-5 h-5 accent-primary"
          />
        </label>

        <div>
          <label className="text-xs font-bold text-muted-foreground">Como o cliente ganha pontos</label>
          <div className="grid sm:grid-cols-2 gap-2 mt-2">
            <button
              type="button"
              onClick={() => setConfig(current => ({ ...current, earning_mode: 'spend' }))}
              className={`rounded-xl border p-3 text-left transition ${config.earning_mode === 'spend' ? 'border-primary bg-primary/10' : 'border-border bg-muted/30'}`}
            >
              <p className="font-bold text-sm">Por valor gasto</p>
              <p className="text-[11px] text-muted-foreground mt-1">Recomendado. Quem compra mais, acumula mais.</p>
            </button>
            <button
              type="button"
              onClick={() => setConfig(current => ({ ...current, earning_mode: 'order' }))}
              className={`rounded-xl border p-3 text-left transition ${config.earning_mode === 'order' ? 'border-primary bg-primary/10' : 'border-border bg-muted/30'}`}
            >
              <p className="font-bold text-sm">Por pedido</p>
              <p className="text-[11px] text-muted-foreground mt-1">Todo pedido elegível vale a mesma quantidade.</p>
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {config.earning_mode === 'spend' ? (
            <div>
              <label className="text-xs font-bold text-muted-foreground">Pontos por R$ 1 gasto</label>
              <input
                type="number"
                min="0.01"
                max="1000"
                step="0.01"
                value={config.points_per_real}
                onChange={event => setConfig(current => ({ ...current, points_per_real: Number(event.target.value) || 0 }))}
                className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Ex.: 1 = R$ 42 elegíveis geram 42 pontos.</p>
            </div>
          ) : (
            <div>
              <label className="text-xs font-bold text-muted-foreground">Pontos por pedido</label>
              <input
                type="number"
                min="1"
                step="1"
                value={config.points_per_order}
                onChange={event => setConfig(current => ({ ...current, points_per_order: Number(event.target.value) || 0 }))}
                className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-muted-foreground">Valor mínimo do pedido (R$)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={config.valor_minimo_pedido}
              onChange={event => setConfig(current => ({ ...current, valor_minimo_pedido: Number(event.target.value) || 0 }))}
              className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Use 0 para não exigir valor mínimo.</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-muted-foreground">Válido a partir de (opcional)</label>
            <input
              type="date"
              value={config.valido_de}
              onChange={event => setConfig(current => ({ ...current, valido_de: event.target.value }))}
              className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground">Válido até (opcional)</label>
            <input
              type="date"
              value={config.valido_ate}
              onChange={event => setConfig(current => ({ ...current, valido_ate: event.target.value }))}
              className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2"
            />
          </div>
        </div>

        <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
          <b className="text-foreground">Proteção automática:</b> um pedido só pontua uma vez. Cancelamentos/estornos depois da pontuação geram reversão. No totem, identificar nome e telefone é opcional; sem identificação o pedido continua normalmente, mas não acumula pontos.
        </div>

        <button
          onClick={() => { void saveConfig(); }}
          disabled={savingConfig}
          className="w-full min-h-11 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {savingConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar regras
        </button>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {[
          { label: 'Clientes com pontos', value: summary.active_customers, icon: Users },
          { label: 'Pontos emitidos', value: summary.points_issued, icon: Coins },
          { label: 'Pontos disponíveis', value: summary.outstanding_points, icon: WalletCards },
          { label: 'Pontos resgatados', value: summary.points_spent, icon: Gift },
          { label: 'Pontos estornados', value: summary.points_reversed, icon: RotateCcw },
          { label: 'Prêmios pendentes', value: summary.pending_rewards, icon: Award },
        ].map(item => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-card border border-border rounded-xl p-3">
              <Icon className="w-4 h-4 text-primary mb-2" />
              <p className="text-xl font-black">{item.value}</p>
              <p className="text-[10px] text-muted-foreground">{item.label}</p>
            </div>
          );
        })}
      </section>

      <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-black flex items-center gap-2"><Gift className="w-5 h-5 text-primary" /> Catálogo de Recompensas</h3>
            <p className="text-xs text-muted-foreground mt-1">Cadastre quantos prêmios quiser. O cliente escolhe onde gastar seus pontos.</p>
          </div>
          <button
            onClick={() => { setRewardForm(DEFAULT_REWARD); setShowRewardForm(true); }}
            className="min-h-10 px-3 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Novo
          </button>
        </div>

        {showRewardForm && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
            <h4 className="font-bold">{rewardForm.id ? 'Editar recompensa' : 'Nova recompensa'}</h4>

            <div>
              <label className="text-xs font-bold text-muted-foreground">Produto da loja (opcional)</label>
              <select
                value={rewardForm.product_id}
                onChange={event => selectRewardProduct(event.target.value)}
                className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2"
              >
                <option value="">Benefício / recompensa manual</option>
                {products.map(product => (
                  <option key={product.id} value={product.id}>
                    {product.name} — venda {formatCurrency(product.price)}
                  </option>
                ))}
              </select>
              {selectedProduct && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Custo cadastrado: <b className="text-foreground">
                    {selectedProduct.cost_price == null ? 'não informado' : formatCurrency(selectedProduct.cost_price)}
                  </b>
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-bold text-muted-foreground">Nome da recompensa</label>
              <input
                value={rewardForm.title}
                onChange={event => setRewardForm(current => ({ ...current, title: event.target.value }))}
                maxLength={120}
                placeholder="Ex.: Batata grátis ou R$ 5 de desconto"
                className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-muted-foreground">Descrição</label>
              <textarea
                value={rewardForm.description}
                onChange={event => setRewardForm(current => ({ ...current, description: event.target.value }))}
                maxLength={300}
                rows={2}
                placeholder="Explique como o cliente recebe o prêmio."
                className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 resize-none"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-muted-foreground">Custo em pontos</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={rewardForm.points_cost}
                  onChange={event => setRewardForm(current => ({ ...current, points_cost: Number(event.target.value) || 0 }))}
                  className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2"
                />
                {equivalentSpend != null && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Equivale a cerca de {formatCurrency(equivalentSpend)} em compras elegíveis.
                  </p>
                )}
              </div>

              <label className="flex items-center gap-2 rounded-xl border border-border p-3 mt-5 sm:mt-0 sm:self-end">
                <input
                  type="checkbox"
                  checked={rewardForm.active}
                  onChange={event => setRewardForm(current => ({ ...current, active: event.target.checked }))}
                  className="w-5 h-5 accent-primary"
                />
                <span className="text-sm font-bold">Recompensa ativa</span>
              </label>
            </div>

            <div>
              <label className="text-xs font-bold text-muted-foreground">Imagem</label>
              <div className="mt-1 flex items-center gap-3">
                <div className="w-16 h-16 rounded-xl bg-muted border border-border overflow-hidden flex items-center justify-center">
                  {rewardForm.image_url
                    ? <img src={rewardForm.image_url} alt="" className="w-full h-full object-cover" />
                    : <ImageIcon className="w-6 h-6 text-muted-foreground" />}
                </div>
                <label className="flex-1 min-h-11 rounded-xl border border-dashed border-border flex items-center justify-center gap-2 cursor-pointer text-sm">
                  {uploadingReward ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploadingReward ? 'Enviando…' : 'Enviar imagem'}
                  <input type="file" accept="image/*" className="hidden" onChange={uploadRewardImage} disabled={uploadingReward} />
                </label>
              </div>
            </div>

            {selectedProduct?.cost_price != null && (
              <div className="rounded-xl border border-success/25 bg-success/5 p-3 text-xs">
                <b>Custo estimado do prêmio: {formatCurrency(selectedProduct.cost_price)}</b>
                {rewardForm.points_cost > 0 && (
                  <span className="text-muted-foreground"> · {formatCurrency(selectedProduct.cost_price / rewardForm.points_cost)} de custo por ponto resgatado</span>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={resetRewardForm}
                className="flex-1 min-h-11 rounded-xl border border-border font-bold text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={() => { void saveReward(); }}
                disabled={savingReward}
                className="flex-1 min-h-11 rounded-xl bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {savingReward ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar
              </button>
            </div>
          </div>
        )}

        {rewards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nenhuma recompensa cadastrada.
          </div>
        ) : (
          <div className="space-y-2">
            {rewards.map(reward => (
              <div key={reward.id} className={`rounded-xl border p-3 flex items-center gap-3 ${reward.active ? 'border-border' : 'border-border opacity-60'}`}>
                <div className="w-14 h-14 rounded-xl bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {reward.image_url
                    ? <img src={reward.image_url} alt={reward.title} className="w-full h-full object-cover" />
                    : reward.reward_type === 'product'
                      ? <Package className="w-5 h-5 text-primary" />
                      : <Gift className="w-5 h-5 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-sm truncate">{reward.title}</p>
                    {!reward.active && <span className="text-[9px] rounded-full bg-muted px-2 py-0.5">INATIVA</span>}
                  </div>
                  {reward.description && <p className="text-[11px] text-muted-foreground truncate">{reward.description}</p>}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px]">
                    <b className="text-primary">{reward.points_cost} pts</b>
                    {(() => { const liveCost = products.find(product => product.id === reward.product_id)?.cost_price ?? reward.estimated_cost; return liveCost != null ? <span className="text-muted-foreground">custo estimado {formatCurrency(liveCost)}</span> : null; })()}
                    {config.earning_mode === 'spend' && config.points_per_real > 0 && (
                      <span className="text-muted-foreground">≈ {formatCurrency(reward.points_cost / config.points_per_real)} em compras</span>
                    )}
                  </div>
                </div>
                <button onClick={() => editReward(reward)} className="p-2 rounded-lg border border-border" aria-label="Editar recompensa">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => { void removeReward(reward); }} className="p-2 rounded-lg bg-destructive/10 text-destructive" aria-label="Excluir recompensa">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-black flex items-center gap-2"><History className="w-5 h-5 text-primary" /> Prêmios Resgatados</h3>
            <p className="text-xs text-muted-foreground mt-1">O cliente reserva com pontos e mostra o código à loja. Confirme aqui somente quando entregar o prêmio.</p>
          </div>
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            <button
              onClick={() => setFilter('pendente')}
              className={`px-3 py-1.5 rounded text-xs font-bold ${filter === 'pendente' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              Pendentes
            </button>
            <button
              onClick={() => setFilter('todos')}
              className={`px-3 py-1.5 rounded text-xs font-bold ${filter === 'todos' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              Todos
            </button>
          </div>
        </div>

        {filteredRedemptions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhum prêmio {filter === 'pendente' ? 'pendente' : 'resgatado ainda'}.
          </p>
        ) : (
          <div className="space-y-2">
            {filteredRedemptions.map(item => (
              <div key={item.id} className="rounded-xl border border-border p-3 flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg bg-muted overflow-hidden flex items-center justify-center">
                  {item.premio_imagem
                    ? <img src={item.premio_imagem} alt="" className="w-full h-full object-cover" />
                    : <Gift className="w-4 h-4 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{item.premio_texto}</p>
                  <p className="text-xs font-mono text-primary">{item.codigo_resgate}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatPhone(item.telefone_cliente)}
                    {Number(item.points_spent) > 0 ? ` · ${item.points_spent} pts` : ''}
                    {' · '}
                    {new Date(item.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                {item.status === 'pendente' ? (
                  <button
                    onClick={() => { void redeem(item.id); }}
                    disabled={redeemingId === item.id}
                    className="px-3 min-h-9 rounded-lg bg-success text-success-foreground text-xs font-bold flex items-center gap-1 disabled:opacity-60"
                  >
                    {redeemingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Entreguei
                  </button>
                ) : (
                  <span className="text-xs text-success font-bold flex items-center gap-1"><Check className="w-3 h-3" /> Utilizado</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="pb-4 text-[11px] text-muted-foreground flex items-start gap-2">
        <Calendar className="w-4 h-4 text-primary flex-shrink-0" />
        Alterações no catálogo valem para novos resgates. Prêmios já reservados mantêm nome, descrição, imagem e pontos do momento em que foram resgatados.
      </div>
    </div>
  );
};

export default LoyaltyPanel;
