import { supabase } from '@/integrations/supabase/client';

/**
 * Dispara uma notificação push via OneSignal quando um ingrediente zera.
 * Lê o App ID atualizado direto da tabela `system_settings`.
 */
export async function triggerRupturaNotification(ingredienteNome: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('system_settings' as any)
      .select('onesignal_app_id, onesignal_api_key')
      .eq('id', 'global')
      .maybeSingle();

    if (error) {
      console.warn('[OneSignal] Falha ao ler system_settings:', error.message);
      return;
    }

    const appId = (data as any)?.onesignal_app_id?.trim();
    const apiKey = (data as any)?.onesignal_api_key?.trim();

    if (!appId) {
      console.warn('[OneSignal] App ID não configurado. Notificação abortada.');
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (apiKey) headers['Authorization'] = `Basic ${apiKey}`;

    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        app_id: appId,
        included_segments: ['All'],
        headings: { pt: '🚨 Ruptura de Estoque' },
        contents: { pt: `O ingrediente "${ingredienteNome}" zerou! Produtos pausados no totem.` },
        android_sound: 'notification_sound',
        ios_sound: 'notification_sound.wav',
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.warn('[OneSignal] Disparo falhou:', res.status, txt);
    } else {
      console.log('[OneSignal] Notificação de ruptura enviada:', ingredienteNome);
    }
  } catch (e: any) {
    console.warn('[OneSignal] Erro inesperado:', e?.message || e);
  }
}
