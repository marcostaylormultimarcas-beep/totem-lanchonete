import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Pause, Play, Loader2, Shield, KeyRound, Mail } from 'lucide-react';
import { toast } from 'sonner';

interface AuthUser {
  id: string;
  email: string;
  created_at: string;
  banned_until: string | null;
  org: { id: string; name: string; slug: string; paused: boolean } | null;
  roles: string[];
}

const callAdminFn = async (
  action: string,
  body?: Record<string, unknown>,
  method: 'GET' | 'POST' | 'DELETE' = 'POST',
) => {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const url = `https://upwstbeimnlgohbqogzz.supabase.co/functions/v1/admin-users?action=${action}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Erro na operação');
  return json;
};

const AdminsPanel = ({ currentAdminId }: { currentAdminId?: string }) => {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newStoreName, setNewStoreName] = useState('');
  const [newMaster, setNewMaster] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await callAdminFn('list', undefined, 'GET');
      setUsers(res.users || []);
    } catch (e: any) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addUser = async () => {
    if (!newEmail.trim() || !newPass) { toast.error('Preencha email e senha'); return; }
    setSaving(true);
    try {
      await callAdminFn('create', {
        email: newEmail.trim().toLowerCase(),
        password: newPass,
        role: newMaster ? 'master_admin' : 'admin',
        store_name: newStoreName.trim() || undefined,
      });
      toast.success('Usuário criado!');
      setNewEmail(''); setNewPass(''); setNewStoreName(''); setNewMaster(false);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
    setSaving(false);
  };

  const togglePause = async (u: AuthUser) => {
    const paused = !!u.banned_until && new Date(u.banned_until) > new Date();
    try {
      await callAdminFn(paused ? 'unpause' : 'pause', { user_id: u.id });
      toast.success(paused ? 'Usuário reativado' : 'Usuário pausado');
      await load();
    } catch (e: any) { toast.error(e.message); }
  };

  const setPassword = async (u: AuthUser, password: string) => {
    if (!password) return;
    try {
      await callAdminFn('set_password', { user_id: u.id, password });
      toast.success('Senha alterada');
    } catch (e: any) { toast.error(e.message); }
  };

  const setMaster = async (u: AuthUser, is_master: boolean) => {
    try {
      await callAdminFn('set_master', { user_id: u.id, is_master });
      toast.success(is_master ? 'Promovido a Master' : 'Master removido');
      await load();
    } catch (e: any) { toast.error(e.message); }
  };

  const removeUser = async (u: AuthUser) => {
    if (u.id === currentAdminId) { toast.error('Não pode excluir você mesmo.'); return; }
    if (!confirm(`Excluir definitivamente "${u.email}"? Isso apaga a loja, produtos e pedidos.`)) return;
    try {
      await callAdminFn('delete', { user_id: u.id }, 'DELETE');
      toast.success('Usuário excluído');
      await load();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="px-4 space-y-4">
      <div className="kiosk-card p-4 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> Novo Usuário</h3>
        <input placeholder="Email" type="email" autoComplete="off" value={newEmail} onChange={e => setNewEmail(e.target.value)}
          className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" />
        <input placeholder="Senha (mín. 6)" type="password" autoComplete="new-password" value={newPass} onChange={e => setNewPass(e.target.value)}
          className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" minLength={6} />
        <input placeholder="Nome da loja (opcional)" value={newStoreName} onChange={e => setNewStoreName(e.target.value)}
          className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={50} />
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={newMaster} onChange={e => setNewMaster(e.target.checked)} className="w-4 h-4 accent-primary" />
          <Shield className="w-4 h-4 text-primary" /> Permissão Master
        </label>
        <p className="text-[11px] text-muted-foreground">Cada usuário recebe automaticamente sua própria loja isolada. As alterações de uma conta não afetam as outras.</p>
        <button onClick={addUser} disabled={saving} className="touch-btn w-full bg-success text-success-foreground py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar conta
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="font-bold text-sm text-muted-foreground">Usuários cadastrados</h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum usuário ainda.</p>
        ) : users.map(u => {
          const paused = !!u.banned_until && new Date(u.banned_until) > new Date();
          const isMaster = u.roles.includes('master');
          return (
            <div key={u.id} className={`kiosk-card p-3 space-y-2 ${paused ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {isMaster && <span title="Master">👑</span>}
                  <Mail className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <p className="font-bold truncate text-sm">{u.email}</p>
                  {paused && <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">Pausado</span>}
                  {u.id === currentAdminId && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">Você</span>}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => togglePause(u)} className="p-2 text-muted-foreground hover:text-primary" title={paused ? 'Reativar' : 'Pausar'}>
                    {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  </button>
                  <button onClick={() => removeUser(u)} className="p-2 text-muted-foreground hover:text-destructive" title="Excluir">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {u.org && (
                <p className="text-xs text-muted-foreground pl-5">Loja: <span className="text-foreground font-semibold">{u.org.name}</span> · <code className="text-[10px]">/cardapio/{u.org.slug}</code></p>
              )}
              <div className="flex gap-2 items-center">
                <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="password" defaultValue="" placeholder="Nova senha" autoComplete="new-password"
                  onBlur={e => { if (e.target.value) { setPassword(u, e.target.value); e.target.value = ''; } }}
                  className="flex-1 px-3 py-2 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-xs" />
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer whitespace-nowrap">
                  <input type="checkbox" checked={isMaster} disabled={u.id === currentAdminId}
                    onChange={e => setMaster(u, e.target.checked)}
                    className="w-3.5 h-3.5 accent-primary" /> Master
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AdminsPanel;
