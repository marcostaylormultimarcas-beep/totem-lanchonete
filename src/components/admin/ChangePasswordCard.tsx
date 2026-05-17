import { useState } from 'react';
import { Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const ChangePasswordCard = () => {
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 6) return toast.error('A nova senha precisa de pelo menos 6 caracteres.');
    if (next !== confirm) return toast.error('As senhas não coincidem.');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: next });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success('Senha alterada com sucesso!');
    setNext(''); setConfirm('');
  };

  return (
    <div className="kiosk-card p-4 space-y-3">
      <h3 className="font-bold flex items-center gap-2"><Lock className="w-5 h-5 text-primary" /> Criar nova senha</h3>
      <p className="text-xs text-muted-foreground">Defina uma nova senha para sua conta. Você continuará logado.</p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Nova senha</label>
          <input type={show ? 'text' : 'password'} value={next} onChange={e => setNext(e.target.value)}
            className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" minLength={6} required />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Confirmar nova senha</label>
          <input type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)}
            className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" minLength={6} required />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <button type="button" onClick={() => setShow(s => !s)} className="p-1 rounded hover:bg-muted">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          {show ? 'Ocultar senha' : 'Mostrar senha'}
        </label>
        <button type="submit" disabled={loading}
          className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />} Salvar nova senha
        </button>
      </form>
    </div>
  );
};

export default ChangePasswordCard;
