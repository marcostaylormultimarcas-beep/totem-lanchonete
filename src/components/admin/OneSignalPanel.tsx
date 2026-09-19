import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Bell, CheckCircle2, KeyRound, Loader2, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

const OneSignalPanel = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [appId, setAppId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [pgNetEnabled, setPgNetEnabled] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('onesignal_admin_config' as any);
    const cfg: any = data;
    if (error) {
      console.error('onesignal_admin_config', error);
      toast.error('Não foi possível carregar a configuração OneSignal.');
    } else if (!cfg?.ok) {
      toast.error(cfg?.reason === 'forbidden' ? 'Apenas o Super Admin pode alterar o OneSignal.' : 'Configuração indisponível.');
    } else {
      setAppId(cfg.app_id || '');
      setHasApiKey(Boolean(cfg.has_api_key));
      setPgNetEnabled(Boolean(cfg.pg_net_enabled));
    }
    setApiKey('');
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    const normalizedAppId = appId.trim();
    if (normalizedAppId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedAppId)) {
      toast.error('App ID inválido. Use o UUID exibido pelo OneSignal.');
      return;
    }
    if (normalizedAppId && !hasApiKey && !apiKey.trim()) {
      toast.error('Informe a App API Key na primeira configuração.');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('set_onesignal_config' as any, {
        _app_id: normalizedAppId,
        _api_key: apiKey.trim() || null,
      });
      const result: any = data;
      if (error) {
        console.error('set_onesignal_config', error);
        toast.error('Erro ao salvar a configuração OneSignal.');
        return;
      }
      if (!result?.ok) {
        const messages: Record<string, string> = {
          forbidden: 'Apenas o Super Admin pode alterar o OneSignal.',
          invalid_app_id: 'App ID inválido.',
          invalid_api_key: 'App API Key inválida.',
        };
        toast.error(messages[result?.reason] || 'Não foi possível salvar a configuração.');
        return;
      }
      setHasApiKey(Boolean(result.has_api_key));
      setApiKey('');
      toast.success('OneSignal salvo com a chave protegida no Vault.');
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-2xl p-6 border border-border">
        <div className="flex items-center gap-3 mb-1">
          <Bell className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-bold">Notificações Push (OneSignal)</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Configuração global do VisionFood. A App API Key é armazenada no Vault e nunca é devolvida ao navegador.
        </p>
      </div>

      <div className="bg-card rounded-2xl p-6 border border-border space-y-4">
        {loading ? (
          <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-border p-3 flex items-center gap-2">
                <ShieldCheck className={`w-4 h-4 ${hasApiKey ? 'text-emerald-500' : 'text-amber-500'}`} />
                <div>
                  <p className="text-xs font-semibold">App API Key</p>
                  <p className="text-[11px] text-muted-foreground">{hasApiKey ? 'Protegida no Vault' : 'Ainda não configurada'}</p>
                </div>
              </div>
              <div className="rounded-xl border border-border p-3 flex items-center gap-2">
                <CheckCircle2 className={`w-4 h-4 ${pgNetEnabled ? 'text-emerald-500' : 'text-amber-500'}`} />
                <div>
                  <p className="text-xs font-semibold">Envio pelo servidor</p>
                  <p className="text-[11px] text-muted-foreground">{pgNetEnabled ? 'pg_net ativo' : 'pg_net indisponível'}</p>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <KeyRound className="w-3 h-3" /> OneSignal App ID
              </label>
              <input
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-input text-sm font-mono"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <KeyRound className="w-3 h-3" /> App API Key
              </label>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasApiKey ? 'Deixe em branco para manter a chave atual' : 'Cole a App API Key do OneSignal'}
                type="password"
                autoComplete="new-password"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-input text-sm font-mono"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Por segurança, a chave já salva nunca é exibida. Digite uma nova chave somente para cadastrar ou substituir.
              </p>
            </div>

            <button
              onClick={save}
              disabled={saving || !pgNetEnabled}
              className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar Configurações
            </button>

            <p className="text-[11px] text-muted-foreground">
              Para assinar este navegador, use o sino de notificações no cabeçalho do ADM depois de salvar o App ID.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default OneSignalPanel;
