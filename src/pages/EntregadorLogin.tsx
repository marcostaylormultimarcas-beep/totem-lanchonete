import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Truck, Lock, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const STORAGE_KEY = 'entregador_session';

const removeStoredSession = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage indisponível não pode derrubar login/logout.
  }
};

const persistEntregadorSession = (session: EntregadorSession) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
};

export interface EntregadorSession {
  id: string;
  name: string;
  username: string;
  organization_id: string;
  org_slug: string;
  org_name: string;
  session_token: string;
  expires_at?: string;
}

export const getEntregadorSession = (): EntregadorSession | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as EntregadorSession;
    const validIdentity = Boolean(
      session
      && typeof session.id === 'string'
      && typeof session.organization_id === 'string'
      && typeof session.org_slug === 'string'
      && typeof session.session_token === 'string'
      && session.session_token.length >= 32,
    );
    if (!validIdentity) {
      removeStoredSession();
      return null;
    }
    if (session.expires_at) {
      const expiresAt = Date.parse(session.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        removeStoredSession();
        return null;
      }
    }
    return session;
  } catch {
    removeStoredSession();
    return null;
  }
};

export const clearEntregadorSession = () => removeStoredSession();

const EntregadorLogin = () => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug?: string }>();
  const [orgSlug, setOrgSlug] = useState(slug || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = getEntregadorSession();
    if (!stored) return;

    const requestedSlug = (slug || '').trim().toLowerCase();
    const storedSlug = stored.org_slug.trim().toLowerCase();
    if (requestedSlug && requestedSlug !== storedSlug) {
      clearEntregadorSession();
      return;
    }

    navigate('/entregador', { replace: true });
  }, [navigate, slug]);

  useEffect(() => {
    if (slug != null) setOrgSlug(slug);
  }, [slug]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const cleanOrgSlug = orgSlug.trim().toLowerCase();
    const cleanUsername = username.trim();
    if (!cleanOrgSlug || !cleanUsername || !password) {
      toast.error('Preencha todos os campos.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('entregador_login_session' as any, {
        _org_slug: cleanOrgSlug,
        _username: cleanUsername,
        _password: password,
      });
      if (error) {
        console.error('[EntregadorLogin] login RPC failed:', error);
        toast.error('Não foi possível entrar agora. Verifique a conexão e tente novamente.');
        return;
      }

      const res: any = data;
      if (!res?.ok) {
        if (res?.reason === 'too_many_attempts') {
          const minutes = Math.max(1, Math.ceil(Number(res?.retry_after_seconds || 600) / 60));
          toast.error(`Muitas tentativas incorretas. Aguarde cerca de ${minutes} minuto(s) e tente novamente.`);
          return;
        }
        if (res?.reason === 'invalid_credentials' && res?.remaining_attempts != null) {
          toast.error(`Usuário ou senha inválidos. Restam ${res.remaining_attempts} tentativa(s).`);
          return;
        }
        if (res?.reason === 'inactive_driver' || res?.reason === 'organization_unavailable') {
          toast.error('Seu acesso de entregador está indisponível. Fale com o administrador da loja.');
          return;
        }
        toast.error('Usuário ou senha inválidos.');
        return;
      }

      const session: EntregadorSession = {
        ...res.entregador,
        session_token: String(res.session_token || ''),
        expires_at: res.expires_at ? String(res.expires_at) : undefined,
      };

      if (!session.id || !session.organization_id || !session.org_slug || session.session_token.length < 32) {
        console.error('[EntregadorLogin] invalid session payload received');
        toast.error('Não foi possível iniciar uma sessão segura. Tente novamente.');
        return;
      }

      if (!persistEntregadorSession(session)) {
        try {
          await supabase.rpc('entregador_logout_session' as any, {
            _session_token: session.session_token,
          });
        } catch {
          // O token expira no servidor; não navegue sem conseguir persistir a sessão local.
        }
        toast.error('O navegador bloqueou o armazenamento da sessão. Libere o armazenamento do site e tente novamente.');
        return;
      }

      toast.success(`Bem-vindo, ${session.name || cleanUsername}!`);
      navigate('/entregador', { replace: true });
    } catch (error) {
      console.error('[EntregadorLogin] login request failed:', error);
      toast.error('Não foi possível entrar agora. Verifique a conexão e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-orange-600/40 rounded-2xl p-6 space-y-5 shadow-[0_0_40px_-10px_rgba(234,88,12,0.4)] relative">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          className="absolute left-4 top-4 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-orange-400 transition-colors"
          aria-label="Voltar"
        >
          ← Voltar
        </button>

        <div className="text-center space-y-2">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-orange-600 items-center justify-center">
            <Truck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-100">Acesso do Entregador</h1>
          <p className="text-sm text-slate-400">Painel exclusivo para entregas</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-400 mb-1 block">Loja (slug)</label>
            <input
              value={orgSlug}
              onChange={e => setOrgSlug(e.target.value)}
              placeholder="ex: minha-lanchonete"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:border-orange-600 outline-none"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 mb-1 block">Usuário</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-slate-100 focus:border-orange-600 outline-none"
                autoComplete="username"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 mb-1 block">Senha</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-slate-100 focus:border-orange-600 outline-none"
                autoComplete="current-password"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-60"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <p className="text-xs text-slate-500 text-center">
          Solicite acesso ao administrador da sua loja.
        </p>
      </div>
    </div>
  );
};

export default EntregadorLogin;
