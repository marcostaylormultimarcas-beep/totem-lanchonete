import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Pencil, Save, X, Truck, History, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface Entregador {
  id: string;
  organization_id: string;
  name: string;
  username: string;
  password: string;
  active: boolean;
  created_at: string;
}

interface DeliveryLog {
  id: string;
  order_id: string;
  entregador_id: string;
  delivered_at: string;
  order_number?: string;
  customer_name?: string;
  total?: number;
  entregador_name?: string;
}

const EntregadoresPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [list, setList] = useState<Entregador[]>([]);
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [editing, setEditing] = useState<Entregador | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<'list' | 'history'>('list');
  const [form, setForm] = useState({ name: '', username: '', password: '', active: true });
  const [orgSlug, setOrgSlug] = useState('');

  const fetchList = async () => {
    if (!organizationId) return;
    const { data } = await supabase.from('entregadores' as any).select('*')
      .eq('organization_id', organizationId).order('created_at', { ascending: false });
    setList((data as any) || []);
  };

  const fetchSlug = async () => {
    if (!organizationId) return;
    const { data } = await supabase.from('organizations').select('slug').eq('id', organizationId).maybeSingle();
    setOrgSlug((data as any)?.slug || '');
  };

  const fetchLogs = async () => {
    if (!organizationId) return;
    const { data: logRows } = await supabase.from('entregas_log' as any).select('*')
      .eq('organization_id', organizationId)
      .order('delivered_at', { ascending: false })
      .limit(100);
    const rows = (logRows as any[]) || [];
    if (rows.length === 0) { setLogs([]); return; }
    const orderIds = [...new Set(rows.map(r => r.order_id))];
    const entIds = [...new Set(rows.map(r => r.entregador_id))];
    const [{ data: orders }, { data: ents }] = await Promise.all([
      supabase.from('orders').select('id,order_number,customer_name,total').in('id', orderIds),
      supabase.from('entregadores' as any).select('id,name').in('id', entIds),
    ]);
    const oMap = new Map((orders || []).map((o: any) => [o.id, o]));
    const eMap = new Map(((ents as any[]) || []).map((e: any) => [e.id, e]));
    setLogs(rows.map(r => ({
      ...r,
      order_number: oMap.get(r.order_id)?.order_number,
      customer_name: oMap.get(r.order_id)?.customer_name,
      total: oMap.get(r.order_id)?.total,
      entregador_name: eMap.get(r.entregador_id)?.name,
    })));
  };

  useEffect(() => { fetchList(); fetchSlug(); fetchLogs(); }, [organizationId]);

  const resetForm = () => { setForm({ name: '', username: '', password: '', active: true }); setEditing(null); setShowForm(false); };

  const handleSave = async () => {
    if (!organizationId) return;
    if (!form.name || !form.username || (!editing && !form.password)) {
      toast.error('Preencha nome, usuário e senha.');
      return;
    }
    if (editing) {
      const payload: any = { name: form.name, username: form.username.trim().toLowerCase(), active: form.active };
      if (form.password) payload.password = form.password;
      const { error } = await supabase.from('entregadores' as any).update(payload).eq('id', editing.id);
      if (error) { toast.error('Erro ao atualizar: ' + error.message); return; }
      toast.success('Entregador atualizado.');
    } else {
      const { error } = await supabase.from('entregadores' as any).insert({
        organization_id: organizationId,
        name: form.name,
        username: form.username.trim().toLowerCase(),
        password: form.password,
        active: form.active,
      });
      if (error) {
        toast.error(error.code === '23505' ? 'Usuário já existe nesta loja.' : 'Erro: ' + error.message);
        return;
      }
      toast.success('Entregador cadastrado.');
    }
    resetForm();
    fetchList();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este entregador?')) return;
    const { error } = await supabase.from('entregadores' as any).delete().eq('id', id);
    if (error) { toast.error('Erro ao excluir.'); return; }
    toast.success('Entregador removido.');
    fetchList();
  };

  const startEdit = (e: Entregador) => {
    setEditing(e);
    setForm({ name: e.name, username: e.username, password: '', active: e.active });
    setShowForm(true);
  };

  return (
    <div className="px-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-black flex items-center gap-2"><Truck className="w-5 h-5 text-primary" /> Entregadores</h2>
        {orgSlug && (
          <a
            href={`/entregador/login/${orgSlug}`}
            target="_blank" rel="noopener noreferrer"
            className="ml-auto text-xs font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Página do entregador
          </a>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('list')} className={`touch-btn px-4 py-2 rounded-lg text-sm ${tab === 'list' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>Cadastros</button>
        <button onClick={() => setTab('history')} className={`touch-btn px-4 py-2 rounded-lg text-sm flex items-center gap-1 ${tab === 'history' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
          <History className="w-4 h-4" /> Histórico
        </button>
      </div>

      {tab === 'list' && (
        <>
          {!showForm && (
            <button onClick={() => { resetForm(); setShowForm(true); }} className="touch-btn w-full bg-success text-success-foreground py-3 rounded-xl flex items-center justify-center gap-2">
              <Plus className="w-5 h-5" /> Cadastrar Entregador
            </button>
          )}

          {showForm && (
            <div className="kiosk-card p-4 space-y-3 border border-primary/30">
              <h3 className="font-bold">{editing ? 'Editar' : 'Novo'} entregador</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-muted-foreground mb-1 block">Nome completo</label>
                  <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full bg-muted border border-border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted-foreground mb-1 block">Usuário (login)</label>
                  <input value={form.username} onChange={e => setForm({...form, username: e.target.value})} className="w-full bg-muted border border-border rounded-lg px-3 py-2" autoComplete="off" />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted-foreground mb-1 block">{editing ? 'Nova senha (em branco = manter)' : 'Senha'}</label>
                  <input type="text" value={form.password} onChange={e => setForm({...form, password: e.target.value})} className="w-full bg-muted border border-border rounded-lg px-3 py-2" autoComplete="off" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.active} onChange={e => setForm({...form, active: e.target.checked})} />
                    Ativo
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
              <Truck className="w-12 h-12 mx-auto mb-2 opacity-40" />
              <p>Nenhum entregador cadastrado.</p>
            </div>
          ) : (
            list.map(e => (
              <div key={e.id} className="kiosk-card p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold flex items-center gap-2">
                    {e.name}
                    {!e.active && <span className="text-[10px] bg-destructive/20 text-destructive px-2 py-0.5 rounded-full">inativo</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">@{e.username}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(e)} className="p-2 rounded-lg bg-muted hover:bg-muted/80"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(e.id)} className="p-2 rounded-lg bg-destructive/20 text-destructive hover:bg-destructive/30"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          <button onClick={fetchLogs} className="text-xs text-muted-foreground underline">Atualizar</button>
          {logs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <History className="w-12 h-12 mx-auto mb-2 opacity-40" />
              <p>Nenhuma entrega registrada ainda.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map(l => (
                <div key={l.id} className="kiosk-card p-3 text-sm">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="font-bold text-primary">#{l.order_number || '—'}</p>
                    <span className="text-xs text-muted-foreground">{new Date(l.delivered_at).toLocaleString('pt-BR')}</span>
                  </div>
                  <p className="text-muted-foreground text-xs mt-1">
                    Cliente: <span className="text-foreground">{l.customer_name || '—'}</span>
                    {typeof l.total === 'number' && <> • R$ {l.total.toFixed(2)}</>}
                  </p>
                  <p className="text-xs mt-1">🛵 Entregue por <span className="font-semibold">{l.entregador_name || '—'}</span></p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default EntregadoresPanel;
