import { useEffect, useState } from 'react';
import { CreditCard, Lock, Loader2, Save, ShieldCheck, Eye, EyeOff, Plug, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  organizationId: string;
}

const mask = (v: string) => (v ? v.slice(0, 6) + '••••••' + v.slice(-4) : '');

const MercadoPagoCard = ({ organizationId }: Props) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [stored, setStored] = useState({ access_token: '', client_id: '', public_key: '' });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const payload: any = {};
    if (accessToken.trim()) payload.access_token = accessToken.trim();
    else payload.organization_id = organizationId;
    const { data, error } = await supabase.functions.invoke('mercadopago-test-token', { body: payload });
    if (error) {
      setTestResult({ ok: false, msg: 'Token inválido' });
      toast.error('Token inválido');
    } else if ((data as any)?.ok) {
      const acc = (data as any).account || {};
      const who = acc.nickname || acc.email || acc.id || 'conta MP';
      setTestResult({ ok: true, msg: `Conexão bem-sucedida (${who})` });
      toast.success('Conexão bem-sucedida com o Mercado Pago');
    } else {
      const msg = (data as any)?.error || 'Token inválido';
      setTestResult({ ok: false, msg });
      toast.error(msg);
    }
    setTesting(false);
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_mp_credentials_for_owner' as any, { _org: organizationId });
    if (!error && (data as any)?.ok) {
      const d = data as any;
      setStored({ access_token: d.access_token || '', client_id: d.client_id || '', public_key: d.public_key || '' });
    }
    setLoading(false);
  };

  useEffect(() => { if (organizationId) load(); /* eslint-disable-next-line */ }, [organizationId]);

  const save = async () => {
    setSaving(true);
    const { data, error } = await supabase.rpc('set_mp_credentials' as any, {
      _org: organizationId,
      _access_token: accessToken,
      _client_id: clientId,
      _public_key: publicKey,
    });
    if (error || !(data as any)?.ok) {
      toast.error('Falha ao salvar credenciais. ' + (error?.message || (data as any)?.reason || ''));
    } else {
      toast.success('Credenciais do Mercado Pago salvas com segurança 🔐');
      setAccessToken(''); setClientId(''); setPublicKey('');
      await load();
    }
    setSaving(false);
  };

  return (
    <div className="kiosk-card p-4 space-y-4 border-2 border-primary/20">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center flex-shrink-0">
          <CreditCard className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold leading-tight">Configurações de Pagamento (Mercado Pago)</h3>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-success" />
            Credenciais criptografadas no Vault — só você tem acesso.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando…
        </div>
      ) : (
        <>
          {(stored.access_token || stored.client_id || stored.public_key) && (
            <div className="rounded-lg bg-success/10 border border-success/30 p-3 space-y-1.5 text-[11px]">
              <p className="font-semibold text-success flex items-center gap-1"><Lock className="w-3 h-3" /> Credenciais ativas</p>
              <div className="grid grid-cols-1 gap-1 font-mono text-muted-foreground">
                {stored.access_token && <span>Access Token: {show ? stored.access_token : mask(stored.access_token)}</span>}
                {stored.client_id   && <span>Client ID:    {show ? stored.client_id   : mask(stored.client_id)}</span>}
                {stored.public_key  && <span>Public Key:   {show ? stored.public_key  : mask(stored.public_key)}</span>}
              </div>
              <button onClick={() => setShow(s => !s)} className="text-primary inline-flex items-center gap-1 mt-1">
                {show ? <><EyeOff className="w-3 h-3" /> Ocultar</> : <><Eye className="w-3 h-3" /> Revelar</>}
              </button>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground block">Access Token (produção)</label>
            <div className="flex gap-2">
              <input
                type="password" autoComplete="off" placeholder="APP_USR-..."
                value={accessToken} onChange={e => { setAccessToken(e.target.value); setTestResult(null); }}
                className="flex-1 min-w-0 px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm font-mono"
                maxLength={300}
              />
              <button
                type="button"
                onClick={testConnection}
                disabled={testing || (!accessToken.trim() && !stored.access_token)}
                title="Testar conexão com o Mercado Pago"
                className="touch-btn px-3 py-3 bg-secondary text-secondary-foreground rounded-lg flex items-center gap-1.5 disabled:opacity-50 text-xs font-semibold whitespace-nowrap"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
                Testar
              </button>
            </div>
            {testResult && (
              <div className={`text-[11px] flex items-center gap-1.5 ${testResult.ok ? 'text-success' : 'text-destructive'}`}>
                {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {testResult.msg}
              </div>
            )}
            <label className="text-xs text-muted-foreground block">Client ID</label>
            <input
              type="text" autoComplete="off" placeholder="1234567890123456"
              value={clientId} onChange={e => setClientId(e.target.value)}
              className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm font-mono"
              maxLength={120}
            />
            <label className="text-xs text-muted-foreground block">Public Key</label>
            <input
              type="text" autoComplete="off" placeholder="APP_USR-..."
              value={publicKey} onChange={e => setPublicKey(e.target.value)}
              className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary text-sm font-mono"
              maxLength={300}
            />
            <p className="text-[11px] text-muted-foreground">
              Deixe em branco o campo que não quiser alterar. Pegue suas credenciais em{' '}
              <a href="https://www.mercadopago.com.br/developers/panel/app" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                developers do Mercado Pago
              </a>.
            </p>
          </div>

          <button
            onClick={save}
            disabled={saving || (!accessToken && !clientId && !publicKey)}
            className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 font-semibold"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar com criptografia
          </button>
        </>
      )}
    </div>
  );
};

export default MercadoPagoCard;
