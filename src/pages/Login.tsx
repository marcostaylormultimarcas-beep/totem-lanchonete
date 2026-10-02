import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { BRAND_NAME } from '@/config/brandConfig';
import { Eye, EyeOff, KeyRound, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = forgotEmail.trim().toLowerCase();
    if (!cleanEmail) { toast.error('Informe seu e-mail'); return; }

    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success('E-mail de recuperação enviado! Verifique sua caixa de entrada.');
      setShowForgot(false);
      setForgotEmail('');
    } catch (error) {
      console.error('[admin-login] password reset request failed:', error);
      toast.error('Não foi possível enviar o link agora. Tente novamente.');
    } finally {
      setForgotLoading(false);
    }
  };

  const routeUser = async (_userId: string) => {
    // Autenticação limpa: após login válido, vai direto ao painel administrativo.
    // A autorização real é revalidada no bootstrapSession do Admin.
    navigate('/admin', { replace: true });
  };

  useEffect(() => {
    let mounted = true;

    // Listener primeiro (síncrono) para capturar SIGNED_IN sem race condition.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN' && session?.user) {
        // Defer para não bloquear o callback interno do Supabase.
        setTimeout(() => {
          if (mounted) void routeUser(session.user.id);
        }, 0);
      }
    });

    void supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (!mounted) return;
        if (error) {
          console.error('[admin-login] session recovery failed:', error);
          return;
        }
        if (session) void routeUser(session.user.id);
      })
      .catch((error) => {
        if (mounted) console.error('[admin-login] session recovery request failed:', error);
      });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      toast.error('Informe email e senha');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (error) {
        toast.error(error.message === 'Invalid login credentials' ? 'Email ou senha incorretos' : error.message);
        return;
      }

      if (data.user) await routeUser(data.user.id);
    } catch (error) {
      console.error('[admin-login] password login request failed:', error);
      toast.error('Não foi possível entrar agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-black tracking-tight text-primary">
              {BRAND_NAME}
            </h1>
            <p className="text-sm text-muted-foreground">Acesso ao painel administrativo</p>
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

            <button
              type="button"
              onClick={() => { setForgotEmail(email); setShowForgot(true); }}
              className="w-full text-center text-sm text-primary/80 hover:text-primary transition font-semibold flex items-center justify-center gap-1.5"
            >
              <KeyRound className="w-4 h-4" /> Esqueci minha senha
            </button>
          </form>
        </div>
      </div>
      <footer className="py-6 text-center text-xs text-muted-foreground">
        Desenvolvido por <span className="font-semibold text-primary/80">VisionTek</span>
      </footer>

      {showForgot && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowForgot(false)}>
          <form
            onSubmit={submitForgot}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" /> Recuperar acesso
              </h3>
              <button type="button" onClick={() => setShowForgot(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Informe o e-mail cadastrado para receber o link de redefinição de senha.
            </p>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">E-mail</label>
              <input
                type="email"
                required
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full bg-muted border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              type="submit"
              disabled={forgotLoading}
              className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {forgotLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Enviar link de recuperação
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default Login;
