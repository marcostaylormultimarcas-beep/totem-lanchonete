import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getBackendFunctionUrl } from '@/lib/backend';
import { Plus, Trash2, Pause, Play, Loader2, Crown, Mail, KeyRound, Store, ShoppingBag, DollarSign, TrendingUp, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { formatCurrency } from '@/data/store';

interface MasterAdmin {
  id: string;
  email: string;
  banned_until: string | null;
  roles: string[];
  storeCount?: number;
}

const callFn = async (
  action: string,
  body?: Record<string, unknown>,
  method: 'GET' | 'POST' | 'DELETE' = 'POST',
  query: Record<string, string> = {},
) => {
  const { data: { session } } = await supabase.auth.getSession();
  const url = getBackendFunctionUrl('admin-users', { action, ...query });
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Erro');
  return json;
};

const SuperAdminPanel = ({ currentUserId }: { currentUserId?: string }) => {
  const [masters, setMasters] = useState<MasterAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  // KPIs
  const [period, setPeriod] = useState<'7d' | '30d' | 'all'>('30d');
  const [orgsCount, setOrgsCount] = useState(0);
  const [orders, setOrders] = useState<{ created_at: string; total: number; organization_id: string }[]>([]);
  const [orgsByMaster, setOrgsByMaster] = useState<Record<string, { name: string; master_id: string | null; id: string }[]>>({});
  const [kpiLoading, setKpiLoading] = useState(true);

  const periodStart = useMemo(() => {
    if (period === 'all') return null;
    const days = period === '7d' ? 7 : 30;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }, [period]);

  const loadKpis = async () => {
    setKpiLoading(true);
    try {
      const { data: orgs } = await supabase.from('organizations').select('id, name, master_id');
      const orgsList = orgs || [];
      setOrgsCount(orgsList.length);
      const grouped: Record<string, any[]> = {};
      orgsList.forEach((o: any) => {
        const key = o.master_id || '__none__';
        (grouped[key] = grouped[key] || []).push(o);
      });
      setOrgsByMaster(grouped);

      let q = supabase.from('orders').select('created_at, total, organization_id').neq('status', 'cancelled');
      if (periodStart) q = q.gte('created_at', periodStart.toISOString());
      const { data: ords } = await q.limit(5000);
      setOrders((ords as any) || []);
    } catch (e: any) {
      console.error(e);
    }
    setKpiLoading(false);
  };

  useEffect(() => { loadKpis(); }, [period]);

  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((s, o) => s + Number(o.total || 0), 0);

  const chartData = useMemo(() => {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 30;
    const map: Record<string, { date: string; pedidos: number; receita: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      map[key] = { date: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), pedidos: 0, receita: 0 };
    }
    orders.forEach(o => {
      const key = o.created_at.slice(0, 10);
      if (map[key]) {
        map[key].pedidos += 1;
        map[key].receita += Number(o.total || 0);
      }
    });
    return Object.values(map);
  }, [orders, period]);

  const masterRanking = useMemo(() => {
    return masters.map(m => {
      const orgIds = new Set((orgsByMaster[m.id] || []).map(o => o.id));
      const lojas = orgIds.size;
      const pedidos = orders.filter(o => orgIds.has(o.organization_id));
      return {
        id: m.id,
        email: m.email,
        lojas,
        pedidos: pedidos.length,
        receita: pedidos.reduce((s, o) => s + Number(o.total || 0), 0),
      };
    }).sort((a, b) => b.receita - a.receita);
  }, [masters, orgsByMaster, orders]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await callFn('list', undefined, 'GET', { scope: 'masters' });
      const list: MasterAdmin[] = res.users || [];
      // contagem de lojas por master
      const { data: orgs } = await supabase
        .from('organizations')
        .select('master_id');
      const counts: Record<string, number> = {};
      (orgs || []).forEach((o: any) => {
        if (o.master_id) counts[o.master_id] = (counts[o.master_id] || 0) + 1;
      });
      setMasters(list.map(m => ({ ...m, storeCount: counts[m.id] || 0 })));
    } catch (e: any) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!email.trim() || !pass) { toast.error('Preencha e-mail e senha'); return; }
    if (pass.length < 6) { toast.error('Senha mínima de 6 caracteres'); return; }
    setSaving(true);
    try {
      await callFn('create', {
        email: email.trim().toLowerCase(),
        password: pass,
        role: 'master_admin',
        store_name: name.trim() || undefined,
      });
      toast.success('Master Admin criado!');
      setEmail(''); setPass(''); setName('');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
    setSaving(false);
  };

  const togglePause = async (u: MasterAdmin) => {
    const paused = !!u.banned_until && new Date(u.banned_until) > new Date();
    try {
      await callFn(paused ? 'unpause' : 'pause', { user_id: u.id });
      toast.success(paused ? 'Master reativado' : 'Master pausado');
      await load();
    } catch (e: any) { toast.error(e.message); }
  };

  const remove = async (u: MasterAdmin) => {
    if (u.id === currentUserId) { toast.error('Não pode excluir você mesmo.'); return; }
    if (!confirm(`Excluir Master "${u.email}"? As lojas vinculadas ficam órfãs (sem master).`)) return;
    try {
      await callFn('delete', { user_id: u.id }, 'DELETE');
      toast.success('Master removido');
      await load();
    } catch (e: any) { toast.error(e.message); }
  };

  const setPassword = async (u: MasterAdmin, password: string) => {
    if (!password) return;
    try {
      await callFn('set_password', { user_id: u.id, password });
      toast.success('Senha alterada');
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="px-4 space-y-5">
      <div className="kiosk-card p-5 space-y-4 border-2 border-primary/30">
        <h3 className="font-bold text-base flex items-center gap-2">
          <Crown className="w-5 h-5 text-primary" /> Cadastrar Novo Master Admin
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Master Admins são licenciados regionais que podem cadastrar lojas vinculadas exclusivamente a eles.
        </p>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Nome do Master (opcional)</label>
          <input placeholder="Ex: Região Sul" value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={60} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">E-mail</label>
          <input type="email" autoComplete="off" placeholder="master@regiao.com" value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Senha (mín. 6 caracteres)</label>
          <input type="password" autoComplete="new-password" placeholder="••••••" value={pass}
            onChange={e => setPass(e.target.value)} minLength={6}
            className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <button onClick={create} disabled={saving}
          className="touch-btn w-full bg-primary text-primary-foreground py-4 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 font-bold text-base">
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
          Criar Master Admin
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="font-bold text-sm text-muted-foreground px-1">Master Admins Cadastrados</h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : masters.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhum Master Admin cadastrado.</p>
        ) : masters.map(u => {
          const paused = !!u.banned_until && new Date(u.banned_until) > new Date();
          return (
            <div key={u.id} className={`kiosk-card p-3 space-y-2 ${paused ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate flex items-center gap-1.5">
                    <Crown className="w-4 h-4 text-primary flex-shrink-0" />
                    {u.email}
                    {paused && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/20 text-destructive">Pausado</span>}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Mail className="w-3 h-3" /> {u.storeCount || 0} loja(s) vinculada(s)
                  </p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => togglePause(u)} className="p-2 text-muted-foreground hover:text-primary" title={paused ? 'Reativar' : 'Pausar'}>
                    {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  </button>
                  <button onClick={() => remove(u)} className="p-2 text-muted-foreground hover:text-destructive" title="Excluir">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex gap-2 items-center">
                <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="password" placeholder="Nova senha" autoComplete="new-password"
                  onBlur={e => { if (e.target.value) { setPassword(u, e.target.value); e.target.value = ''; } }}
                  className="flex-1 px-3 py-2 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-xs" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SuperAdminPanel;
