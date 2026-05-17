import { useEffect, useState } from 'react';
import { Plus, Trash2, Ticket, Loader2, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Cupom {
  id: string;
  codigo: string;
  tipo: 'porcentagem' | 'valor_fixo';
  valor: number;
  status: 'ativo' | 'inativo';
  data_inicio: string | null;
  data_fim: string | null;
}

interface Props {
  organizationId: string | null;
}

const formatBR = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const CouponsPanel = ({ organizationId }: Props) => {
  const [cupons, setCupons] = useState<Cupom[]>([]);
  const [loading, setLoading] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [tipo, setTipo] = useState<'porcentagem' | 'valor_fixo'>('porcentagem');
  const [valor, setValor] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!organizationId) { setCupons([]); return; }
    setLoading(true);
    const { data } = await supabase
      .from('cupons' as any)
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    setCupons((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [organizationId]);

  const handleCreate = async () => {
    if (!organizationId) return;
    const code = codigo.trim().toUpperCase();
    const v = parseFloat(valor);
    if (!code || !v || v <= 0) {
      toast.error('Preencha código e valor válidos.');
      return;
    }
    if (dataInicio && dataFim && new Date(dataInicio) >= new Date(dataFim)) {
      toast.error('A data de início deve ser anterior à data de expiração.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('cupons' as any).insert({
      organization_id: organizationId,
      codigo: code,
      tipo,
      valor: v,
      status: ativo ? 'ativo' : 'inativo',
      data_inicio: dataInicio ? new Date(dataInicio).toISOString() : null,
      data_fim: dataFim ? new Date(dataFim).toISOString() : null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message.includes('duplicate') ? 'Já existe um cupom com este código.' : 'Erro ao criar cupom.');
      return;
    }
    toast.success('Cupom criado!');
    setCodigo(''); setValor(''); setAtivo(true); setTipo('porcentagem');
    setDataInicio(''); setDataFim('');
    load();
  };

  const toggleStatus = async (c: Cupom) => {
    const novo = c.status === 'ativo' ? 'inativo' : 'ativo';
    await supabase.from('cupons' as any).update({ status: novo }).eq('id', c.id);
    setCupons(prev => prev.map(x => x.id === c.id ? { ...x, status: novo } : x));
  };

  const remove = async (c: Cupom) => {
    if (!confirm(`Excluir o cupom "${c.codigo}"?`)) return;
    await supabase.from('cupons' as any).delete().eq('id', c.id);
    setCupons(prev => prev.filter(x => x.id !== c.id));
    toast.success('Cupom excluído.');
  };

  return (
    <div className="px-4 space-y-4">
      <div className="kiosk-card p-4 space-y-3">
        <h3 className="font-bold flex items-center gap-2"><Ticket className="w-5 h-5 text-primary" /> Novo Cupom</h3>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Código do Cupom</label>
          <input value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} placeholder="Ex: GANHE10"
            className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary uppercase" maxLength={30} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value as any)}
              className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary">
              <option value="porcentagem">Desconto em %</option>
              <option value="valor_fixo">Valor Fixo R$</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Valor</label>
            <input type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)}
              placeholder={tipo === 'porcentagem' ? 'Ex: 10' : 'Ex: 5.00'}
              className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Válido a partir de (opcional)</label>
            <input type="datetime-local" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
              className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Válido até (opcional)</label>
            <input type="datetime-local" value={dataFim} onChange={e => setDataFim(e.target.value)}
              className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" />
          </div>
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} className="w-5 h-5 accent-primary" />
          <span className="text-sm">Ativo</span>
        </label>
        <button onClick={handleCreate} disabled={saving}
          className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar Cupom
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="font-bold text-sm text-muted-foreground">Cupons Cadastrados</h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : cupons.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhum cupom cadastrado.</p>
        ) : cupons.map(c => (
          <div key={c.id} className="kiosk-card p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-bold">{c.codigo}</p>
              <p className="text-xs text-muted-foreground">
                {c.tipo === 'porcentagem' ? `${c.valor}% de desconto` : `R$ ${Number(c.valor).toFixed(2)} fixo`}
              </p>
              {(c.data_inicio || c.data_fim) && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Calendar className="w-3 h-3" />
                  {c.data_inicio && !c.data_fim && `Inicia em: ${formatBR(c.data_inicio)}`}
                  {!c.data_inicio && c.data_fim && `Expira em: ${formatBR(c.data_fim)}`}
                  {c.data_inicio && c.data_fim && `${formatBR(c.data_inicio)} → ${formatBR(c.data_fim)}`}
                </p>
              )}
            </div>
            <button onClick={() => toggleStatus(c)}
              className={`text-xs px-3 py-1.5 rounded-full font-semibold ${c.status === 'ativo' ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'}`}>
              {c.status === 'ativo' ? 'Ativo' : 'Inativo'}
            </button>
            <button onClick={() => remove(c)} className="p-2 text-muted-foreground hover:text-destructive">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CouponsPanel;
