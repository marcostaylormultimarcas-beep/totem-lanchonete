import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const routeUser = async (userId: string) => {
    const { data: roles } = await supabase
      .from('user_roles' as any)
      .select('role')
      .eq('user_id', userId);
    const list = (roles || []).map((r: any) => r.role);
    const isSuper = list.includes('super_admin') || list.includes('master');
    const isMasterAdmin = list.includes('master_admin');
    const isAdmin = list.includes('admin');

    if (isSuper || isMasterAdmin) {
      // Super Admin → painel global; Master Admin → painel regional (mesmo /admin, abas filtradas)
      navigate('/admin');
      return;
    }
    if (isAdmin) {
      // Lojista → painel da sua loja
      navigate('/admin');
      return;
    }
    toast.error('Sua conta não tem acesso ao sistema.');
    await supabase.auth.signOut();
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) routeUser(session.user.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast.error(error.message === 'Invalid login credentials' ? 'Email ou senha incorretos' : error.message);
      setLoading(false);
      return;
    }
    if (data.user) await routeUser(data.user.id);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-black tracking-tight">
              <span className="text-primary">Vision</span> Mídia Digital
            </h1>
            <p className="text-sm text-muted-foreground">Acesso ao sistema de autoatendimento</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-sm font-semibold text-muted-foreground mb-1 block">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-muted border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="seu@email.com"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-muted-foreground mb-1 block">Senha</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-bold text-lg disabled:opacity-50 hover:opacity-90 transition"
            >
              {loading ? 'Entrando...' : 'Entrar no Sistema'}
            </button>
          </form>
        </div>
      </div>
      <footer className="py-6 text-center text-xs text-muted-foreground">
        Desenvolvido por <span className="font-semibold text-primary/80">VisionTek</span>
      </footer>
    </div>
  );
};

export default Login;
