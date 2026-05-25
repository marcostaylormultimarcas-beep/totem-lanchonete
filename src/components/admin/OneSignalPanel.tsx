import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Bell, Loader2, Save, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

const OneSignalPanel = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [appId, setAppId] = useState('');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('system_settings' as any)
        .select('onesignal_app_id, onesignal_api_key')
        .eq('id', 'global')
        .maybeSingle();
      if (error) {
        console.warn(error);
      } else if (data) {
        setAppId((data as any).onesignal_app_id || '');
        setApiKey((data as any).onesignal_api_key || '');
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('system_settings' as any)
      .upsert(
        {
          id: 'global',
          onesignal_app_id: appId.trim(),
          onesignal_api_key: apiKey.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );
    setSaving(false);
    if (error) toast.error('Erro ao salvar: ' + error.message);
    else toast.success('Configurações OneSignal salvas');
  };

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-2xl p-6 border border-border">
        <div className="flex items-center gap-3 mb-1">
          <Bell className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-bold">Notificações Push (OneSignal)</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure o OneSignal para receber alertas automáticos no celular sempre que um
          ingrediente zerar e produtos forem pausados no totem.
        </p>
      </div>

      <div className="bg-card rounded-2xl p-6 border border-border space-y-4">
        {loading ? (
          <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : (
          <>
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
                <KeyRound className="w-3 h-3" /> REST API Key (opcional, recomendado)
              </label>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Chave REST do painel OneSignal"
                type="password"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-input text-sm font-mono"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                A REST API Key é necessária pelo OneSignal para autenticar o disparo via servidor.
              </p>
            </div>

            <button
              onClick={save}
              disabled={saving}
              className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar Configurações
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default OneSignalPanel;
