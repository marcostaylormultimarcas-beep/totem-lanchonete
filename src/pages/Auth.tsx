import { getKioskHomePath } from '@/lib/kioskHome';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/contexts/OrgContext';

import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

const KIOSK_ORG_STORAGE_KEY = 'kiosk_org_id';
const KIOSK_SLUG_STORAGE_KEY = 'kiosk_slug';

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
  const returnTo = searchParams.get('returnTo') || getKioskHomePath();
  const { orgId, org } = useOrg();

  const resolveSignupOrganizationId = async () => {
    if (orgId) return orgId;

    const slugFromReturnTo = extractStoreSlug(returnTo);
    const slugFromStorage = localStorage.getItem(KIOSK_SLUG_STORAGE_KEY)?.trim().toLowerCase() || '';
    const slug = slugFromReturnTo || slugFromStorage || org?.slug || '';
    if (slug) {
      const { data } = await supabase
        .from('organizations')
        .select('id, slug')
        .eq('slug', slug)
        .maybeSingle();
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
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate(returnTo);
    });
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

    const { data: emailExists, error: emailCheckError } = await supabase.rpc('email_already_registered' as any, {
      _email: cleanEmailValue,
    });
    if (!emailCheckError && emailExists === true) {
      toast.error('Este e-mail já está cadastrado. Faça login para continuar.');
      setMode('login');
      setLoading(false);
      return;
    }

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

      const userId = data.user?.id || (await supabase.auth.getUser()).data.user?.id;
      if (userId) {
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            user_id: userId,
            display_name: name.trim(),
            email: cleanEmailValue,
            phone: cleanPhoneValue || phone.trim(),
            organization_id: origemOrgId,
            origem_assinatura_empresa_id: origemOrgId,
          } as any, { onConflict: 'user_id' });

        if (profileError) {
          console.error('[signup] profile upsert failed', profileError);
          const duplicate = profileError.message.toLowerCase().includes('duplicate') || profileError.code === '23505';
          toast.error(duplicate ? 'Este e-mail já está cadastrado. Faça login para continuar.' : 'Conta criada, mas não foi possível vincular o cliente à loja. Tente entrar novamente.');
          setLoading(false);
          return;
        }
      }

      localStorage.setItem(KIOSK_ORG_STORAGE_KEY, origemOrgId);
      toast.success('Conta criada com sucesso!');
      navigate(returnTo);
    }
    setLoading(false);
  };

  const handleForgot = async () => {
    if (!email.trim()) { toast.error('Informe seu email'); return; }
    setLoading(true);
    const host = window.location.hostname;
    const baseUrl = host.includes('lovable') || host === 'localhost' || host.startsWith('127.')
      ? 'https://totemlonchonete.netlify.app'
      : window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${baseUrl}/reset-password`,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Enviamos um link de recuperação para seu email.');
      setMode('login');
    }
    setLoading(false);
  };

  // Login com Google removido conforme solicitação.


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

          {/* Login com Google removido */}


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
