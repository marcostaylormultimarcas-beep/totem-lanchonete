import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Pause, Play, Loader2, Shield, Building2 } from 'lucide-react';

interface AdminUser {
  id: string;
  username: string;
  password: string;
  is_master: boolean;
  paused: boolean;
  organization_id: string | null;
}

interface OrgRef { id: string; name: string; slug: string; }

const AdminsPanel = ({ currentAdminId, allOrgs = [], onOrgsChanged }: { currentAdminId?: string; allOrgs?: OrgRef[]; onOrgsChanged?: () => void }) => {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUser, setNewUser] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newMaster, setNewMaster] = useState(false);
  const [newOrgId, setNewOrgId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('admins').select('*').order('created_at', { ascending: true });
    setAdmins((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (!newOrgId && allOrgs.length) setNewOrgId(allOrgs[0].id); }, [allOrgs]);

  const orgName = (id: string | null) => allOrgs.find(o => o.id === id)?.name || (id ? '—' : 'Sem loja');

  const addAdmin = async () => {
    const u = newUser.trim().toLowerCase();
    if (!u || !newPass) { alert('Preencha usuário e senha'); return; }
    if (!newMaster && !newOrgId) { alert('Selecione a loja deste admin.'); return; }
    setSaving(true);
    const payload: any = { username: u, password: newPass, is_master: newMaster, paused: false };
    // Master is global; non-master must be tied to an organization
    payload.organization_id = newMaster ? null : newOrgId;
    const { error } = await supabase.from('admins').insert(payload);
    if (error) {
      alert(error.message.includes('duplicate') ? 'Esse usuário já existe.' : 'Erro: ' + error.message);
    } else {
      setNewUser(''); setNewPass(''); setNewMaster(false);
      await load();
    }
    setSaving(false);
  };

  const togglePause = async (a: AdminUser) => {
    await supabase.from('admins').update({ paused: !a.paused }).eq('id', a.id);
    await load();
  };

  const updatePassword = async (a: AdminUser, newPassword: string) => {
    if (!newPassword) return;
    await supabase.from('admins').update({ password: newPassword }).eq('id', a.id);
    await load();
  };

  const updateOrg = async (a: AdminUser, orgId: string) => {
    await supabase.from('admins').update({ organization_id: orgId || null }).eq('id', a.id);
    await load();
  };

  const removeAdmin = async (a: AdminUser) => {
    if (a.id === currentAdminId) { alert('Você não pode remover sua própria conta.'); return; }
    if (a.is_master && admins.filter(x => x.is_master).length <= 1) {
      alert('É necessário pelo menos 1 admin master.');
      return;
    }
    if (!confirm(`Remover admin "${a.username}"?`)) return;
    await supabase.from('admins').delete().eq('id', a.id);
    await load();
  };

  return (
    <div className="px-4 space-y-4">
      <div className="kiosk-card p-4 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> Novo Admin</h3>
        <input placeholder="Usuário" value={newUser} onChange={e => setNewUser(e.target.value)} autoComplete="off" className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={30} />
        <input placeholder="Senha" type="password" autoComplete="new-password" value={newPass} onChange={e => setNewPass(e.target.value)} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={50} />
        {!newMaster && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1"><Building2 className="w-3 h-3" /> Loja deste admin</label>
            <select value={newOrgId} onChange={e => setNewOrgId(e.target.value)} className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary">
              {allOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={newMaster} onChange={e => setNewMaster(e.target.checked)} className="w-4 h-4 accent-primary" />
          <Shield className="w-4 h-4 text-primary" /> Permissão Master (acesso global a todas as lojas)
        </label>
        <button onClick={addAdmin} disabled={saving} className="touch-btn w-full bg-success text-success-foreground py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="font-bold text-sm text-muted-foreground">Admins cadastrados</h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : admins.map(a => (
          <div key={a.id} className={`kiosk-card p-3 space-y-2 ${a.paused ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {a.is_master && <span title="Master">👑</span>}
                <p className="font-bold truncate">{a.username}</p>
                {a.paused && <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">Pausado</span>}
                {a.id === currentAdminId && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">Você</span>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => togglePause(a)} className="p-2 text-muted-foreground hover:text-primary" title={a.paused ? 'Reativar' : 'Pausar'}>
                  {a.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                </button>
                <button onClick={() => removeAdmin(a)} className="p-2 text-muted-foreground hover:text-destructive" title="Remover">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            {!a.is_master && (
              <div className="flex items-center gap-2">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <select value={a.organization_id || ''} onChange={e => updateOrg(a, e.target.value)}
                  className="flex-1 px-2 py-1.5 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-xs">
                  <option value="">— Sem loja —</option>
                  {allOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-2 items-center">
              <input type="password" defaultValue="" placeholder="Definir nova senha" autoComplete="new-password"
                onBlur={e => { if (e.target.value) { updatePassword(a, e.target.value); e.target.value = ''; } }}
                className="flex-1 px-3 py-2 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-xs" maxLength={50} />
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer whitespace-nowrap">
                <input type="checkbox" checked={a.is_master} disabled={a.id === currentAdminId}
                  onChange={async e => { await supabase.from('admins').update({ is_master: e.target.checked, organization_id: e.target.checked ? null : a.organization_id }).eq('id', a.id); await load(); }}
                  className="w-3.5 h-3.5 accent-primary" /> Master
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AdminsPanel;
