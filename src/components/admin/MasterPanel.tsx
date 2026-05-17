import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Pause, Play, Loader2, Store, Link as LinkIcon, Mail } from 'lucide-react';
import { toast } from 'sonner';

interface MasterUser {
  id: string;
  email: string;
  banned_until: string | null;
  org: { id: string; name: string; slug: string; paused: boolean } | null;
  roles: string[];
}

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

const callFn = async (
  action: string,
  body?: Record<string, unknown>,
  method: 'GET' | 'POST' | 'DELETE' = 'POST',
) => {
  const { data: { session } } = await supabase.auth.getSession();
  const url = `https://upwstbeimnlgohbqogzz.supabase.co/functions/v1/admin-users?action=${action}`;
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

const MasterPanel = ({ currentAdminId }: { currentAdminId?: string }) => {
  const [users, setUsers] = useState<MasterUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeName, setStoreName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await callFn('list', undefined, 'GET');
      // Apenas lanchonetes (usuários com org). Esconde Masters puros sem loja.
      setUsers((res.users || []).filter((u: MasterUser) => u.org));
    } catch (e: any) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const onNameChange = (v: string) => {
    setStoreName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const create = async () => {
    if (!storeName.trim() || !email.trim() || !pass) {
      toast.error('Preencha nome, e-mail e senha');
      return;
    }
    if (pass.length < 6) { toast.error('Senha mínima de 6 caracteres'); return; }
    const finalSlug = slugify(slug || storeName);
    if (!finalSlug) { toast.error('Slug inválido'); return; }
    setSaving(true);
    try {
      await callFn('create', {
        email: email.trim().toLowerCase(),
        password: pass,
        store_name: storeName.trim(),
        slug: finalSlug,
        is_master: false,
      });
      toast.success('Lanchonete cadastrada e ativada!');
      setStoreName(''); setSlug(''); setSlugTouched(false); setEmail(''); setPass('');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
    setSaving(false);
  };

  const togglePause = async (u: MasterUser) => {
    const paused = !!u.banned_until && new Date(u.banned_until) > new Date();
    try {
      await callFn(paused ? 'unpause' : 'pause', { user_id: u.id });
      toast.success(paused ? 'Loja reativada' : 'Loja pausada');
      await load();
    } catch (e: any) { toast.error(e.message); }
  };

  const remove = async (u: MasterUser) => {
    if (u.id === currentAdminId) { toast.error('Não pode excluir você mesmo.'); return; }
    if (!confirm(`Excluir "${u.org?.name || u.email}"? Apaga loja, produtos e pedidos.`)) return;
    try {
      await callFn('delete', { user_id: u.id }, 'DELETE');
      toast.success('Lanchonete removida');
      await load();
    } catch (e: any) { toast.error(e.message); }
  };

  const totemUrl = (s: string) => `${window.location.origin}/cardapio/${s}`;

  return (
    <div className="px-4 space-y-5">
      {/* Formulário único */}
      <div className="kiosk-card p-5 space-y-4">
        <h3 className="font-bold text-base flex items-center gap-2">
          <Store className="w-5 h-5 text-primary" /> Cadastrar Nova Lanchonete
        </h3>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Nome da Loja</label>
          <input placeholder="Ex: Pizzaria do Zé" value={storeName}
            onChange={e => onNameChange(e.target.value)}
            className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={60} />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Slug da URL</label>
          <div className="flex items-center gap-1 bg-muted rounded-lg px-3">
            <span className="text-xs text-muted-foreground">/loja/</span>
            <input placeholder="pizzaria-do-ze" value={slug}
              onChange={e => { setSlug(slugify(e.target.value)); setSlugTouched(true); }}
              className="flex-1 py-3 bg-transparent outline-none" maxLength={50} />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">E-mail do Administrador</label>
          <input type="email" autoComplete="off" placeholder="admin@loja.com" value={email}
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
          className="touch-btn w-full bg-success text-success-foreground py-4 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 font-bold text-base">
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
          Cadastrar e Ativar Loja
        </button>
      </div>

      {/* Lista geral */}
      <div className="space-y-2">
        <h3 className="font-bold text-sm text-muted-foreground px-1">Lanchonetes Parceiras</h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhuma lanchonete cadastrada.</p>
        ) : users.map(u => {
          const paused = !!u.banned_until && new Date(u.banned_until) > new Date();
          return (
            <div key={u.id} className={`kiosk-card p-3 space-y-1.5 ${paused ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate flex items-center gap-1.5">
                    <Store className="w-4 h-4 text-primary flex-shrink-0" />
                    {u.org?.name || '—'}
                    {paused && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/20 text-destructive">Pausada</span>}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                    <Mail className="w-3 h-3 flex-shrink-0" /> {u.email}
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
              {u.org && (
                <button onClick={() => { navigator.clipboard.writeText(totemUrl(u.org!.slug)); toast.success('Link copiado!'); }}
                  className="w-full text-left text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1 truncate">
                  <LinkIcon className="w-3 h-3 flex-shrink-0" /> {totemUrl(u.org.slug)}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MasterPanel;
