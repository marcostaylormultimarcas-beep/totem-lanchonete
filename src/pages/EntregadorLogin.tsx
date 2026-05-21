import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Truck, Lock, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const STORAGE_KEY = 'entregador_session';

export interface EntregadorSession {
  id: string;
  name: string;
  username: string;
  organization_id: string;
  org_slug: string;
  org_name: string;
  password: string;
}

export const getEntregadorSession = (): EntregadorSession | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export const clearEntregadorSession = () => localStorage.removeItem(STORAGE_KEY);

const EntregadorLogin = () => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug?: string }>();
  const [orgSlug, setOrgSlug] = useState(slug || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getEntregadorSession()) navigate('/entregador');
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgSlug || !username || !password) {
      toast.error('Preencha todos os campos.');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc('entregador_login' as any, {
      _org_slug: orgSlug.trim().toLowerCase(),
      _username: username.trim(),
      _password: password,
    });
    setLoading(false);
    const res: any = data;
    if (error || !res?.ok) {
      const msg: Record<string, string> = {
        org_not_found: 'Loja não encontrada.',
        invalid_credentials: 'Usuário ou senha inválidos.',
      };
      toast.error(msg[res?.reason] || 'Falha ao entrar.');
      return;
    }
    const session: EntregadorSession = { ...res.entregador, password };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    toast.success(`Bem-vindo, ${res.entregador.name}!`);
    navigate('/entregador');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-orange-600/40 rounded-2xl p-6 space-y-5 shadow-[0_0_40px_-10px_rgba(234,88,12,0.4)]">
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
