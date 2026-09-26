import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  clearPasswordRecoveryIntent,
  hasPasswordRecoveryIntent,
  markPasswordRecoveryIntent,
} from '@/lib/passwordRecovery';
import { ArrowLeft, Eye, EyeOff, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

type RecoveryState = 'checking' | 'ready' | 'invalid';

const RECOVERY_VALIDATION_TIMEOUT_MS = 4000;

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('checking');
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    let recoveryDetected = false;

    const acceptRecovery = () => {
      recoveryDetected = true;
      markPasswordRecoveryIntent();
      if (mounted) setRecoveryState('ready');
    };

    const validationTimer = window.setTimeout(() => {
      if (!mounted || recoveryDetected) return;
      clearPasswordRecoveryIntent();
      setRecoveryState('invalid');
    }, RECOVERY_VALIDATION_TIMEOUT_MS);

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') {
        acceptRecovery();
        window.clearTimeout(validationTimer);
      }
    });

    void supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (!mounted) return;

        if (error) {
          console.error('[reset-password] session recovery failed:', error);
          if (!recoveryDetected) {
            clearPasswordRecoveryIntent();
            setRecoveryState('invalid');
          }
          return;
        }

        if (session && hasPasswordRecoveryIntent()) {
          recoveryDetected = true;
          window.clearTimeout(validationTimer);
          setRecoveryState('ready');
        }
      })
      .catch((error) => {
        if (!mounted) return;
        console.error('[reset-password] session recovery request failed:', error);
        if (!recoveryDetected) {
          clearPasswordRecoveryIntent();
          setRecoveryState('invalid');
        }
      });

    return () => {
      mounted = false;
      window.clearTimeout(validationTimer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOutRecoverySession = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (!error) return true;
      console.warn('[reset-password] global sign-out failed:', error);
    } catch (error) {
      console.warn('[reset-password] global sign-out request failed:', error);
    }

    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (!error) return true;
      console.error('[reset-password] local sign-out failed:', error);
    } catch (error) {
      console.error('[reset-password] local sign-out request failed:', error);
    }

    return false;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recoveryState !== 'ready') {
      toast.error('Este link de recuperação não está mais válido.');
      return;
    }
    if (password.length < 6) { toast.error('A senha deve ter ao menos 6 caracteres'); return; }
    if (password !== confirm) { toast.error('As senhas não coincidem'); return; }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error(error.message);
        return;
      }

      clearPasswordRecoveryIntent();
      const signedOut = await signOutRecoverySession();

      if (!signedOut) {
        toast.success('Senha atualizada com sucesso!');
        toast.error('A senha foi alterada, mas não foi possível encerrar esta sessão. Atualize a página e tente entrar novamente.');
        setRecoveryState('invalid');
        return;
      }

      toast.success('Senha atualizada com sucesso!');
      navigate('/auth', { replace: true });
    } catch (error) {
      console.error('[reset-password] password update request failed:', error);
      toast.error('Não foi possível atualizar a senha agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const ready = recoveryState === 'ready';

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex items-center gap-4 p-4 border-b border-border">
        <button onClick={() => navigate('/auth')} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Redefinir senha</h1>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-md mx-auto w-full">
        <div className="w-full space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
              <KeyRound className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-2xl font-black text-primary">
              {recoveryState === 'invalid' ? 'Link de recuperação inválido' : 'Crie uma nova senha'}
            </h2>
            <p className="text-muted-foreground text-sm">
              {ready
                ? 'Defina sua nova senha de acesso.'
                : recoveryState === 'invalid'
                  ? 'O link expirou, já foi usado ou não pertence a um fluxo de recuperação válido.'
                  : 'Validando link de recuperação...'}
            </p>
          </div>

          {ready && (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-muted-foreground mb-1 block">Nova senha</label>
                <div className="relative">
                  <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    className="w-full bg-muted border border-border rounded-xl px-4 py-3 pr-12 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Mínimo 6 caracteres" required minLength={6} />
                  <button type="button" onClick={() => setShow(!show)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold text-muted-foreground mb-1 block">Confirmar senha</label>
                <input type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Repita a nova senha" required minLength={6} />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-bold text-lg disabled:opacity-50">
                {loading ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </form>
          )}

          {recoveryState === 'invalid' && (
            <button
              type="button"
              onClick={() => navigate('/auth', { replace: true })}
              className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-bold"
            >
              Solicitar novo link
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
