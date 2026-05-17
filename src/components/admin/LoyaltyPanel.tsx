import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Award, Save, Loader2, Upload, Image as ImageIcon, Gift, Check, History } from 'lucide-react';
import { toast } from 'sonner';
import { uploadProductImage, StorageLimitError } from '@/lib/imageUpload';

interface Config {
  id?: string;
  ativo: boolean;
  meta_pedidos: number;
  valor_minimo_pedido: number;
  premio_recompensa: string;
  descricao_premio: string;
  premio_imagem: string;
}

interface Resgate {
  id: string;
  telefone_cliente: string;
  premio_texto: string;
  premio_imagem: string;
  codigo_resgate: string;
  status: 'pendente' | 'utilizado';
  created_at: string;
  used_at: string | null;
}

const DEFAULT: Config = {
  ativo: false,
  meta_pedidos: 10,
  valor_minimo_pedido: 30,
  premio_recompensa: 'Ganhe um brinde especial',
  descricao_premio: '',
  premio_imagem: '',
};

const formatPhone = (p: string) => {
  const d = p.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return p;
};

const LoyaltyPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [resgates, setResgates] = useState<Resgate[]>([]);
  const [filter, setFilter] = useState<'pendente' | 'todos'>('pendente');

  const fetchAll = async () => {
    if (!organizationId) return;
    setLoading(true);
    const [{ data: cfg }, { data: rs }] = await Promise.all([
      supabase.from('config_fidelidade' as any).select('*').eq('organization_id', organizationId).maybeSingle(),
      supabase.from('resgates_fidelidade' as any).select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(100),
    ]);
    if (cfg) {
      const d = cfg as any;
      setConfig({
        id: d.id,
        ativo: !!d.ativo,
        meta_pedidos: Number(d.meta_pedidos) || 10,
        valor_minimo_pedido: Number(d.valor_minimo_pedido) || 0,
        premio_recompensa: d.premio_recompensa || '',
        descricao_premio: d.descricao_premio || '',
        premio_imagem: d.premio_imagem || '',
      });
    } else {
      setConfig(DEFAULT);
    }
    setResgates((rs as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    if (!organizationId) return;
    const channel = supabase.channel('admin-resgates-' + organizationId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resgates_fidelidade', filter: `organization_id=eq.${organizationId}` }, fetchAll)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [organizationId]);

  const save = async () => {
    if (!organizationId) return;
    if (config.meta_pedidos < 1) { toast.error('Meta deve ser ao menos 1.'); return; }
    if (!config.premio_recompensa.trim()) { toast.error('Informe o prêmio.'); return; }
    setSaving(true);
    const payload = {
      organization_id: organizationId,
      ativo: config.ativo,
      meta_pedidos: config.meta_pedidos,
      valor_minimo_pedido: config.valor_minimo_pedido,
      premio_recompensa: config.premio_recompensa.trim(),
      descricao_premio: config.descricao_premio.trim(),
      premio_imagem: config.premio_imagem,
    };
    let error;
    if (config.id) {
      ({ error } = await supabase.from('config_fidelidade' as any).update(payload).eq('id', config.id));
    } else {
      const res = await supabase.from('config_fidelidade' as any).insert(payload).select().maybeSingle();
      error = res.error;
      if (res.data) setConfig(c => ({ ...c, id: (res.data as any).id }));
    }
    setSaving(false);
    if (error) toast.error('Erro ao salvar: ' + error.message);
    else toast.success('Cartão Fidelidade atualizado!');
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !organizationId) return;
    setUploading(true);
    try {
      const url = await uploadProductImage(file, organizationId);
      setConfig(c => ({ ...c, premio_imagem: url }));
      toast.success('Imagem enviada. Clique em Salvar para confirmar.');
    } catch (err) {
      toast.error(err instanceof StorageLimitError ? err.message : 'Erro ao enviar imagem.');
    } finally {
      setUploading(false);
    }
  };

  const redeem = async (id: string) => {
    if (!confirm('Confirmar entrega deste prêmio ao cliente?')) return;
    const { data, error } = await supabase.rpc('redeem_loyalty_prize' as any, { _resgate_id: id });
    const res: any = data;
    if (error || !res?.ok) {
      toast.error('Não foi possível resgatar: ' + (res?.reason || error?.message || 'erro'));
      return;
    }
    toast.success('Prêmio marcado como utilizado!');
    fetchAll();
  };

  const filtered = filter === 'pendente' ? resgates.filter(r => r.status === 'pendente') : resgates;

  if (!organizationId) return <div className="p-4 text-muted-foreground">Selecione uma loja.</div>;
  if (loading) return <div className="p-4 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin"/> Carregando…</div>;

  return (
    <div className="px-4 space-y-4">
      <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center">
            <Award className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Cartão Fidelidade</h2>
            <p className="text-xs text-muted-foreground">Personalize as regras do seu programa de fidelidade.</p>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 bg-muted/40 rounded-xl px-4 py-3 cursor-pointer">
          <div>
            <div className="text-sm font-semibold text-foreground">Programa ativo</div>
            <div className="text-xs text-muted-foreground">Quando ativo, os clientes veem o cartão na loja.</div>
          </div>
          <input
            type="checkbox"
            className="w-12 h-7 appearance-none rounded-full bg-muted relative cursor-pointer transition-colors checked:bg-primary
              before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:w-6 before:h-6 before:bg-background before:rounded-full before:transition-transform
              checked:before:translate-x-5"
            checked={config.ativo}
            onChange={e => setConfig(c => ({ ...c, ativo: e.target.checked }))}
          />
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Carimbos para completar</label>
            <input type="number" min={1} value={config.meta_pedidos}
              onChange={e => setConfig(c => ({ ...c, meta_pedidos: parseInt(e.target.value) || 0 }))}
              className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Valor mínimo do pedido (R$)</label>
            <input type="number" min={0} step="0.01" value={config.valor_minimo_pedido}
              onChange={e => setConfig(c => ({ ...c, valor_minimo_pedido: parseFloat(e.target.value) || 0 }))}
              className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground" />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Texto da recompensa</label>
          <input type="text" maxLength={120} placeholder="Ex: Ganhe um X-Burger Grátis"
            value={config.premio_recompensa}
            onChange={e => setConfig(c => ({ ...c, premio_recompensa: e.target.value }))}
            className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground" />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Descrição extra (opcional)</label>
          <textarea maxLength={300} rows={2}
            placeholder="Detalhes do prêmio que aparecem no modal do cliente."
            value={config.descricao_premio}
            onChange={e => setConfig(c => ({ ...c, descricao_premio: e.target.value }))}
            className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground resize-none" />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Foto do prêmio</label>
          <div className="mt-1 flex items-center gap-3">
            <div className="w-20 h-20 rounded-xl bg-muted border border-border overflow-hidden flex items-center justify-center flex-shrink-0">
              {config.premio_imagem ? (
                <img src={config.premio_imagem} alt="Prêmio" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon className="w-7 h-7 text-muted-foreground" />
              )}
            </div>
            <label className="touch-btn flex-1 bg-muted hover:bg-muted/70 text-foreground py-3 rounded-lg flex items-center justify-center gap-2 cursor-pointer text-sm">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Enviando...' : 'Enviar imagem'}
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
            {config.premio_imagem && (
              <button onClick={() => setConfig(c => ({ ...c, premio_imagem: '' }))}
                className="text-xs text-destructive underline">Remover</button>
            )}
          </div>
        </div>

        <button onClick={save} disabled={saving}
          className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar configurações
        </button>
      </div>

      {/* Registro de Prêmios */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            <h3 className="text-base font-bold text-foreground">Registro de Prêmios</h3>
          </div>
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            <button onClick={() => setFilter('pendente')}
              className={`px-3 py-1.5 rounded text-xs font-semibold ${filter === 'pendente' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
              Pendentes
            </button>
            <button onClick={() => setFilter('todos')}
              className={`px-3 py-1.5 rounded text-xs font-semibold ${filter === 'todos' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
              Todos
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nenhum prêmio {filter === 'pendente' ? 'pendente' : 'gerado ainda'}.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map(r => (
              <div key={r.id} className={`flex items-center gap-3 p-3 rounded-xl border ${
                r.status === 'pendente' ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30 opacity-70'
              }`}>
                <div className="w-12 h-12 rounded-lg bg-background border border-border overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {r.premio_imagem ? (
                    <img src={r.premio_imagem} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Gift className="w-5 h-5 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-foreground truncate">{r.premio_texto}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatPhone(r.telefone_cliente)} · <span className="font-mono text-primary">{r.codigo_resgate}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleString('pt-BR')}
                    {r.used_at && ` · usado em ${new Date(r.used_at).toLocaleString('pt-BR')}`}
                  </div>
                </div>
                {r.status === 'pendente' ? (
                  <button onClick={() => redeem(r.id)}
                    className="touch-btn bg-success text-success-foreground px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1">
                    <Check className="w-4 h-4" /> Entregar
                  </button>
                ) : (
                  <span className="text-xs text-success font-semibold flex items-center gap-1">
                    <Check className="w-3 h-3" /> Utilizado
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LoyaltyPanel;
