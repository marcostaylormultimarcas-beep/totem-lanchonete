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
  const [forgotPin, setForgotPin] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = forgotEmail.trim().toLowerCase();
    if (!cleanEmail) { toast.error('Informe seu e-mail'); return; }
    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setForgotLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('E-mail de recuperação enviado! Verifique sua caixa de entrada.');
    setShowForgot(false);
    setForgotEmail('');
    setForgotPin('');
  };

  const routeUser = async (_userId: string) => {
    // Autenticação limpa: após login válido, vai direto ao painel administrativo.
    // A criação do registro em `profiles` é feita pelo trigger `handle_new_user`
    // no Supabase quando o usuário ainda não existe na tabela real.
    navigate('/admin', { replace: true });
  };

  useEffect(() => {
    let mounted = true;
    // Listener primeiro (síncrono) para capturar SIGNED_IN sem race condition
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN' && session?.user) {
        // defer p/ não bloquear o callback
        setTimeout(() => routeUser(session.user.id), 0);
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted && session) routeUser(session.user.id);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
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
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block flex items-center gap-1">
                PIN de Recuperação <span className="text-[10px] font-normal text-muted-foreground/70">(apenas Master Admin)</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{4,6}"
                maxLength={6}
                value={forgotPin}
                onChange={e => setForgotPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Opcional — 4 a 6 dígitos"
                className="w-full bg-muted border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary text-center font-mono tracking-widest"
              />
              <p className="text-[10px] text-muted-foreground mt-1.5">
                O PIN é usado pelo suporte para confirmar a sua identidade quando aplicável.
              </p>
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
