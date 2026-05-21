import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Pencil, Save, X, MapPin } from 'lucide-react';
import { toast } from 'sonner';

interface Bairro {
  id: string;
  organization_id: string;
  nome_bairro: string;
  valor_taxa: number;
  tempo_estimado: number;
  ativo: boolean;
  created_at: string;
}

const BairrosPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [list, setList] = useState<Bairro[]>([]);
  const [editing, setEditing] = useState<Bairro | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome_bairro: '', valor_taxa: '0', tempo_estimado: '30', ativo: true });

  const fetchList = async () => {
    if (!organizationId) return;
    const { data } = await supabase.from('taxas_entrega' as any).select('*')
      .eq('organization_id', organizationId).order('nome_bairro', { ascending: true });
    setList((data as any) || []);
  };

  useEffect(() => { fetchList(); }, [organizationId]);

  const resetForm = () => { setForm({ nome_bairro: '', valor_taxa: '0', tempo_estimado: '30', ativo: true }); setEditing(null); setShowForm(false); };

  const handleSave = async () => {
    if (!organizationId) return;
    const nome = form.nome_bairro.trim();
    if (!nome) { toast.error('Informe o nome do bairro.'); return; }
    const valor = Number(form.valor_taxa.replace(',', '.')) || 0;
    const tempo = Math.max(1, parseInt(form.tempo_estimado) || 30);

    if (editing) {
      const { error } = await supabase.from('taxas_entrega' as any).update({
        nome_bairro: nome, valor_taxa: valor, tempo_estimado: tempo, ativo: form.ativo,
      }).eq('id', editing.id);
      if (error) { toast.error(error.code === '23505' ? 'Já existe um bairro com esse nome.' : 'Erro: ' + error.message); return; }
      toast.success('Bairro atualizado.');
    } else {
      const { error } = await supabase.from('taxas_entrega' as any).insert({
        organization_id: organizationId,
        nome_bairro: nome, valor_taxa: valor, tempo_estimado: tempo, ativo: form.ativo,
      });
      if (error) { toast.error(error.code === '23505' ? 'Já existe um bairro com esse nome.' : 'Erro: ' + error.message); return; }
      toast.success('Bairro cadastrado.');
    }
    resetForm(); fetchList();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este bairro? Pedidos antigos não serão alterados.')) return;
    const { error } = await supabase.from('taxas_entrega' as any).delete().eq('id', id);
    if (error) { toast.error('Erro ao excluir.'); return; }
    toast.success('Bairro removido.');
    fetchList();
  };

  const toggleActive = async (b: Bairro) => {
    await supabase.from('taxas_entrega' as any).update({ ativo: !b.ativo }).eq('id', b.id);
    fetchList();
  };

  const startEdit = (b: Bairro) => {
    setEditing(b);
    setForm({
      nome_bairro: b.nome_bairro,
      valor_taxa: String(b.valor_taxa).replace('.', ','),
      tempo_estimado: String(b.tempo_estimado),
      ativo: b.ativo,
    });
    setShowForm(true);
  };

  return (
    <div className="px-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-black flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary" /> Bairros e Taxas de Entrega
        </h2>
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        Cadastre os bairros que sua loja atende. Os clientes irão escolher o bairro no checkout e a taxa será somada automaticamente ao total.
      </p>

      {!showForm && (
        <button onClick={() => { resetForm(); setShowForm(true); }} className="touch-btn w-full bg-success text-success-foreground py-3 rounded-xl flex items-center justify-center gap-2">
          <Plus className="w-5 h-5" /> Cadastrar Bairro
        </button>
      )}

      {showForm && (
        <div className="kiosk-card p-4 space-y-3 border border-primary/30">
          <h3 className="font-bold">{editing ? 'Editar' : 'Novo'} bairro</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-muted-foreground mb-1 block">Nome do bairro</label>
              <input value={form.nome_bairro} onChange={e => setForm({...form, nome_bairro: e.target.value})} className="w-full bg-muted border border-border rounded-lg px-3 py-2" placeholder="Ex: Centro" />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground mb-1 block">Taxa de entrega (R$)</label>
              <input inputMode="decimal" value={form.valor_taxa} onChange={e => setForm({...form, valor_taxa: e.target.value.replace(/[^\d.,]/g, '')})} className="w-full bg-muted border border-border rounded-lg px-3 py-2" placeholder="Ex: 8,00" />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground mb-1 block">Tempo estimado (min)</label>
              <input inputMode="numeric" value={form.tempo_estimado} onChange={e => setForm({...form, tempo_estimado: e.target.value.replace(/\D/g, '')})} className="w-full bg-muted border border-border rounded-lg px-3 py-2" placeholder="30" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.ativo} onChange={e => setForm({...form, ativo: e.target.checked})} />
                Ativo (visível no checkout)
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex-1 touch-btn py-2 rounded-lg bg-primary text-primary-foreground font-bold flex items-center justify-center gap-1">
              <Save className="w-4 h-4" /> Salvar
            </button>
            <button onClick={resetForm} className="touch-btn py-2 px-4 rounded-lg bg-muted text-muted-foreground flex items-center gap-1">
              <X className="w-4 h-4" /> Cancelar
            </button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <MapPin className="w-12 h-12 mx-auto mb-2 opacity-40" />
          <p>Nenhum bairro cadastrado.</p>
          <p className="text-xs mt-1">Sem bairros, os clientes não conseguem escolher entrega.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(b => (
            <div key={b.id} className="kiosk-card p-3 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-bold flex items-center gap-2 flex-wrap">
                  <MapPin className="w-4 h-4 text-primary" /> {b.nome_bairro}
                  {!b.ativo && <span className="text-[10px] bg-destructive/20 text-destructive px-2 py-0.5 rounded-full">inativo</span>}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Taxa: <span className="text-primary font-bold">R$ {Number(b.valor_taxa).toFixed(2)}</span>
                  {' • '}Tempo: ~{b.tempo_estimado} min
                </p>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => toggleActive(b)}
                  className={`text-[10px] font-bold px-2 py-1 rounded ${b.ativo ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}
                  title="Ativar/desativar"
                >{b.ativo ? 'ON' : 'OFF'}</button>
                <button onClick={() => startEdit(b)} className="p-2 rounded-lg bg-muted hover:bg-muted/80"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => handleDelete(b.id)} className="p-2 rounded-lg bg-destructive/20 text-destructive hover:bg-destructive/30"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BairrosPanel;
