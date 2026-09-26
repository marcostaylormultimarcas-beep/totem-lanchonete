import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CreditCard, Save, Loader2, ShieldCheck, KeyRound, DollarSign, MessageCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const MasterBillingPanel = () => {
  const [loading, setLoading] = useState(true);
  const [savingValor, setSavingValor] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [savingWpp, setSavingWpp] = useState(false);
  const [valor, setValor] = useState<number>(197);
  const [whatsapp, setWhatsapp] = useState('');
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: sys }, { data: hasT }] = await Promise.all([
      supabase.from('system_settings').select('*').eq('id', 'global').maybeSingle(),
      supabase.rpc('has_master_mp_token' as any),
    ]);
    setValor(Number((sys as any)?.valor_plano_padrao ?? 197));
    setWhatsapp(((sys as any)?.whatsapp_suporte || '') as string);
    setHasToken(Boolean(hasT));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const salvarValor = async () => {
    if (!valor || valor <= 0) { toast.error('Valor inválido'); return; }
    setSavingValor(true);
    const { data, error } = await supabase.rpc('set_valor_plano_padrao' as any, { _valor: valor });
    setSavingValor(false);
    if (error || !(data as any)?.ok) { toast.error('Erro ao salvar valor'); return; }
    toast.success('Valor do plano atualizado!');
  };

  const salvarWhatsapp = async () => {
    const digits = whatsapp.replace(/\D/g, '');
    if (digits.length < 10) { toast.error('Informe o número com DDD (ex: 11999998888)'); return; }
    setSavingWpp(true);
    const { data, error } = await supabase.rpc('set_system_whatsapp_suporte' as any, { _whatsapp: digits });
    setSavingWpp(false);
    if (error || !(data as any)?.ok) {
      toast.error((data as any)?.reason || error?.message || 'Erro ao salvar WhatsApp');
      return;
    }
    setWhatsapp(digits);
    toast.success('WhatsApp central de atendimento salvo!');
  };

  const salvarToken = async () => {
    if (!token.trim()) { toast.error('Cole o Access Token do Mercado Pago'); return; }
    setSavingToken(true);
    const { data, error } = await supabase.rpc('set_master_mp_token' as any, { _token: token.trim() });
    setSavingToken(false);
    if (error || !(data as any)?.ok) { toast.error('Falha ao salvar token'); return; }
    toast.success('Chave do Mercado Pago salva com segurança 🔐');
    setToken('');
    setHasToken(true);
  };


  if (loading) {
    return <div className="px-4 py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="px-4 space-y-4 max-w-3xl">
      <div className="kiosk-card p-5 space-y-4 border-2 border-primary/30">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/20 text-primary flex items-center justify-center">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-black text-lg leading-tight">Valor do Plano (Padrão)</h3>
            <p className="text-xs text-muted-foreground">Valor de referência exibido no painel de assinatura das lojas.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 flex items-center bg-muted rounded-lg px-3">
            <span className="text-sm text-muted-foreground mr-2">R$</span>
            <input
              type="number" step="0.01" min={1} value={valor}
              onChange={e => setValor(Number(e.target.value))}
              className="w-full py-3 bg-transparent outline-none font-mono text-lg font-bold"
            />
            <span className="text-xs text-muted-foreground ml-2">/ mês</span>
          </div>
          <button onClick={salvarValor} disabled={savingValor}
            className="touch-btn bg-primary text-primary-foreground px-4 rounded-lg flex items-center gap-1.5 disabled:opacity-50 font-bold">
            {savingValor ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </button>
        </div>
      </div>

      <div className="kiosk-card p-5 space-y-4 border-2 border-success/30">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-success/20 text-success flex items-center justify-center">
            <MessageCircle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-black text-lg leading-tight">WhatsApp Central de Atendimento</h3>
            <p className="text-xs text-muted-foreground">Usado quando a loja não tem WhatsApp próprio (ex.: solicitação de troca de plano).</p>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 flex items-center bg-muted rounded-lg px-3">
            <span className="text-sm text-muted-foreground mr-2">+55</span>
            <input
              type="tel" inputMode="numeric" placeholder="11999998888"
              value={whatsapp} onChange={e => setWhatsapp(e.target.value)}
              className="w-full py-3 bg-transparent outline-none font-mono text-lg font-bold"
            />
          </div>
          <button onClick={salvarWhatsapp} disabled={savingWpp}
            className="touch-btn bg-success text-white px-4 rounded-lg flex items-center gap-1.5 disabled:opacity-50 font-bold">
            {savingWpp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </button>
        </div>
      </div>



      <div className="kiosk-card p-5 space-y-4 border-2 border-primary/20">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/20 text-primary flex items-center justify-center">
            <CreditCard className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h3 className="font-black text-lg leading-tight">Chave API Mercado Pago (Master)</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <ShieldCheck className="w-3 h-3 text-success" /> Armazenada no Vault — criptografada.
            </p>
          </div>
        </div>

        {hasToken && (
          <div className="rounded-lg bg-success/10 border border-success/30 p-3 text-xs text-success flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Chave Master ativa. Cole abaixo para substituir.
          </div>
        )}

        <input
          type="password" autoComplete="off" placeholder="APP_USR-...."
          value={token} onChange={e => setToken(e.target.value)}
          className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm font-mono"
        />
        <button onClick={salvarToken} disabled={savingToken || !token.trim()}
          className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 font-bold">
          {savingToken ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar com criptografia
        </button>

        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            A credencial Master está preparada no Vault. A cobrança recorrente automática ainda não está publicada;
            atualmente contratação e regularização são concluídas pelo atendimento via WhatsApp.
          </span>
        </div>
      </div>
    </div>
  );
};

export default MasterBillingPanel;
