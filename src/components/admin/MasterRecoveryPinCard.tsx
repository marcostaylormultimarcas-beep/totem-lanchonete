import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { KeyRound, Loader2, Save, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

const hashPin = async (pin: string): Promise<string> => {
  const enc = new TextEncoder().encode(`vision::${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};

interface Props {
  userId: string;
}

const MasterRecoveryPinCard = ({ userId }: Props) => {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [hasPin, setHasPin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancel = false;
    supabase
      .from('profiles')
      .select('recovery_pin_hash')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancel) return;
        setHasPin(Boolean((data as any)?.recovery_pin_hash));
      });
    return () => { cancel = true; };
  }, [userId]);

  const save = async () => {
    if (!/^\d{4,6}$/.test(pin)) { toast.error('O PIN deve ter 4 a 6 dígitos'); return; }
    if (pin !== confirm) { toast.error('Os PINs não coincidem'); return; }
    setSaving(true);
    try {
      const hash = await hashPin(pin);
      const { error } = await supabase
        .from('profiles')
        .update({ recovery_pin_hash: hash } as any)
        .eq('user_id', userId);
      if (error) throw error;
      toast.success('PIN de recuperação salvo!');
      setHasPin(true);
      setPin('');
      setConfirm('');
    } catch (e: any) {
      toast.error(e.message || 'Falha ao salvar PIN');
    }
    setSaving(false);
  };

  return (
    <div className="kiosk-card p-4 space-y-3 border-2 border-primary/20">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center flex-shrink-0">
          <KeyRound className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold leading-tight flex items-center gap-2">
            PIN de Recuperação Master
            {hasPin && <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Configurado</span>}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Código numérico de 4 a 6 dígitos usado pelo suporte Vision Tech para confirmar sua identidade em recuperações de acesso.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="Novo PIN"
          className="px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-center font-mono tracking-widest"
        />
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={confirm}
          onChange={e => setConfirm(e.target.value.replace(/\D/g, ''))}
          placeholder="Confirmar PIN"
          className="px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-center font-mono tracking-widest"
        />
      </div>

      <button
        onClick={save}
        disabled={saving || !pin || !confirm}
        className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 font-semibold"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {hasPin ? 'Atualizar PIN' : 'Salvar PIN'}
      </button>
    </div>
  );
};

export default MasterRecoveryPinCard;
