import { getKioskHomePath } from '@/lib/kioskHome';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { fetchPublicOrganization } from '@/lib/publicOrganization';
import { useOrg } from '@/contexts/OrgContext';

import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

const KIOSK_ORG_STORAGE_KEY = 'kiosk_org_id';
const KIOSK_SLUG_STORAGE_KEY = 'kiosk_slug';
const GOOGLE_OAUTH_RETURN_TO_KEY = 'visionfood_google_oauth_return_to';
const GOOGLE_OAUTH_ORG_ID_KEY = 'visionfood_google_oauth_org_id';

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const cleanPhone = (value: string) => value.replace(/\D/g, '');

const extractStoreSlug = (path: string | null) => {
  if (!path) return '';
  try {
    const decoded = decodeURIComponent(path);
    const match = decoded.match(/\/(?:loja|cardapio)\/([^/?#]+)/i);
    return match?.[1]?.trim().toLowerCase() || '';
  } catch {
    return '';
  }
};

const Auth = () => {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const storedGoogleReturnTo = (() => {
    try {
      return sessionStorage.getItem(GOOGLE_OAUTH_RETURN_TO_KEY) || '';
    } catch {
      return '';
    }
  })();
  const returnTo = searchParams.get('returnTo') || storedGoogleReturnTo || getKioskHomePath();
  const { orgId, org } = useOrg();

  const resolveSignupOrganizationId = async () => {
    if (orgId) return orgId;

    const slugFromReturnTo = extractStoreSlug(returnTo);
    const slugFromStorage = localStorage.getItem(KIOSK_SLUG_STORAGE_KEY)?.trim().toLowerCase() || '';
    const slug = slugFromReturnTo || slugFromStorage || org?.slug || '';
    if (slug) {
      const data = await fetchPublicOrganization({ slug });
      if (data?.id) {
        localStorage.setItem(KIOSK_ORG_STORAGE_KEY, data.id);
        localStorage.setItem(KIOSK_SLUG_STORAGE_KEY, data.slug);
        return data.id;
      }
    }

    const storedOrgId = localStorage.getItem(KIOSK_ORG_STORAGE_KEY);
    if (storedOrgId) return storedOrgId;

    return '';
  };

  useEffect(() => {
    let cancelled = false;
    let handled = false;

    const completeAuthenticatedReturn = async (knownSession?: any) => {
      if (handled || cancelled) return;

      const session = knownSession || (await supabase.auth.getSession()).data.session;
      if (!session || handled || cancelled) return;

      handled = true;

      let googleOrgId = '';
      try {
        googleOrgId = sessionStorage.getItem(GOOGLE_OAUTH_ORG_ID_KEY) || '';
      } catch {
        googleOrgId = '';
      }

      if (googleOrgId) {
        const { error: profileLinkError } = await supabase.rpc('visionfood_link_google_profile', {
          _organization_id: googleOrgId,
        });
        if (profileLinkError) {
          console.error('[google-oauth] profile organization link failed:', profileLinkError);
          toast.error('Login com Google realizado, mas não foi possível vincular sua conta à loja.');
        }
      }

      try {
        sessionStorage.removeItem(GOOGLE_OAUTH_RETURN_TO_KEY);
        sessionStorage.removeItem(GOOGLE_OAUTH_ORG_ID_KEY);
      } catch {
        // Navegação continua mesmo se o storage do navegador estiver indisponível.
      }

      if (!cancelled) navigate(returnTo);
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void completeAuthenticatedReturn(session);
    });

    void completeAuthenticatedReturn();

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, [navigate, returnTo]);

  const handleLogin = async () => {
    const cleanEmailValue = normalizeEmail(email);
    if (!cleanEmailValue) { toast.error('Informe seu email'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: cleanEmailValue, password });
    if (error) {
      toast.error(error.message === 'Invalid login credentials' ? 'Email ou senha incorretos' : error.message);
    } else {
      toast.success('Login realizado!');
      navigate(returnTo);
    }
    setLoading(false);
  };

  const handleSignup = async () => {
    if (!name.trim()) { toast.error('Informe seu nome'); return; }
    const cleanEmailValue = normalizeEmail(email);
    const cleanPhoneValue = cleanPhone(phone);
    if (!cleanEmailValue) { toast.error('Informe seu email'); return; }
    setLoading(true);
    const origemOrgId = await resolveSignupOrganizationId();
    if (!origemOrgId) {
      toast.error('Não foi possível identificar a loja deste cadastro. Volte ao cardápio e tente novamente.');
      setLoading(false);
      return;
    }
    localStorage.setItem(KIOSK_ORG_STORAGE_KEY, origemOrgId);

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmailValue,
      password,
      options: {
        data: {
          display_name: name.trim(),
          phone: cleanPhoneValue || phone.trim(),
          organization_id: origemOrgId,
          origem_assinatura_empresa_id: origemOrgId,
        },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) {
      const message = error.message.toLowerCase().includes('already') || error.message.toLowerCase().includes('registered')
        ? 'Este e-mail já está cadastrado. Faça login para continuar.'
        : error.message;
      toast.error(message);
    } else {
      if (data.user && (!data.user.identities || data.user.identities.length === 0)) {
        toast.error('Este e-mail já está cadastrado. Faça login para continuar.');
        setMode('login');
        setLoading(false);
        return;
      }

      if (data.session) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      }

      // O perfil e o vínculo com a loja são criados pelo trigger handle_new_user.
      // O cliente não pode alterar organization_id/origem_assinatura_empresa_id diretamente.

      toast.success('Conta criada com sucesso!');
      navigate(returnTo);
    }
    setLoading(false);
  };

  const handleForgot = async () => {
    if (!email.trim()) { toast.error('Informe seu email'); return; }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Enviamos um link de recuperação para seu email.');
      setMode('login');
    }
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const googleOrgId = await resolveSignupOrganizationId();
      sessionStorage.setItem(GOOGLE_OAUTH_RETURN_TO_KEY, returnTo);
      if (googleOrgId) {
        localStorage.setItem(KIOSK_ORG_STORAGE_KEY, googleOrgId);
        sessionStorage.setItem(GOOGLE_OAUTH_ORG_ID_KEY, googleOrgId);
      } else {
        sessionStorage.removeItem(GOOGLE_OAUTH_ORG_ID_KEY);
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth`,
        },
      });
      if (error) throw error;
    } catch (error: any) {
      try {
        sessionStorage.removeItem(GOOGLE_OAUTH_RETURN_TO_KEY);
        sessionStorage.removeItem(GOOGLE_OAUTH_ORG_ID_KEY);
      } catch {
        // O erro de OAuth abaixo continua sendo exibido.
      }
      toast.error(error?.message || 'Não foi possível entrar com Google');
      setLoading(false);
    }
  };


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'login') handleLogin();
    else if (mode === 'signup') handleSignup();
    else handleForgot();
  };

  const titleMap = { login: 'Entrar', signup: 'Criar Conta', forgot: 'Recuperar senha' };
  const heroMap = {
    login: { t: '👋 Bem-vindo de volta!', s: 'Entre para acompanhar seus pedidos' },
    signup: { t: '🎉 Crie sua conta', s: 'Cadastre-se para salvar seu histórico' },
    forgot: { t: '🔐 Esqueceu a senha?', s: 'Enviaremos um link para redefinir sua senha' },
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex items-center gap-4 p-4 border-b border-border">
        <button onClick={() => navigate(getKioskHomePath())} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">{titleMap[mode]}</h1>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-md mx-auto w-full py-8">
        <div className="w-full space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-black text-primary">{heroMap[mode].t}</h2>
            <p className="text-muted-foreground text-sm">{heroMap[mode].s}</p>
          </div>

          {mode === 'login' && (
            <>
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full bg-card border border-border py-3.5 rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-muted transition disabled:opacity-50"
              >
                <span className="w-6 h-6 rounded-full bg-background border border-border flex items-center justify-center text-sm font-black">G</span>
                Continuar com Google
              </button>
              <div className="flex items-center gap-3">
                <div className="h-px bg-border flex-1" />
                <span className="text-xs text-muted-foreground">ou continue com e-mail</span>
                <div className="h-px bg-border flex-1" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="text-sm font-semibold text-muted-foreground mb-1 block">Nome</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)}
                    className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Seu nome completo" required />
                </div>
                <div>
                  <label className="text-sm font-semibold text-muted-foreground mb-1 block">Telefone</label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                    className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="(00) 00000-0000" />
                </div>
              </>
            )}

            <div>
              <label className="text-sm font-semibold text-muted-foreground mb-1 block">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="seu@email.com" required />
            </div>

            {mode !== 'forgot' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-semibold text-muted-foreground">Senha</label>
                  {mode === 'login' && (
                    <button type="button" onClick={() => setMode('forgot')} className="text-xs text-primary hover:underline">
                      Esqueci minha senha
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    className="w-full bg-muted border border-border rounded-xl px-4 py-3 pr-12 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Mínimo 6 caracteres" required minLength={6} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-bold text-lg disabled:opacity-50">
              {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar Conta' : 'Enviar link de recuperação'}
            </button>
          </form>

          <div className="text-center space-y-2">
            {mode === 'login' && (
              <button onClick={() => setMode('signup')} className="text-primary font-semibold text-sm hover:underline">
                Não tem conta? Cadastre-se
              </button>
            )}
            {mode === 'signup' && (
              <button onClick={() => setMode('login')} className="text-primary font-semibold text-sm hover:underline">
                Já tem conta? Faça login
              </button>
            )}
            {mode === 'forgot' && (
              <button onClick={() => setMode('login')} className="text-primary font-semibold text-sm hover:underline">
                ← Voltar para o login
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
