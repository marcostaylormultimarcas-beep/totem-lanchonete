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

/**
 * Dispara um push preditivo (estoque vai acabar nos próximos N dias) para administradores.
 * Usa filtro por tag `tipo = admin` no OneSignal.
 */
export async function triggerPredictiveStockAlert(ingredienteNome: string, diasRestantes: number): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('system_settings' as any)
      .select('onesignal_app_id, onesignal_api_key')
      .eq('id', 'global')
      .maybeSingle();
    if (error) { console.warn('[OneSignal] Falha system_settings:', error.message); return; }

    const appId = (data as any)?.onesignal_app_id?.trim();
    const apiKey = (data as any)?.onesignal_api_key?.trim();
    if (!appId) { console.warn('[OneSignal] App ID ausente. Push preditivo abortado.'); return; }

    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
    if (apiKey) headers['Authorization'] = `Basic ${apiKey}`;

    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        app_id: appId,
        filters: [{ field: 'tag', key: 'tipo', relation: '=', value: 'admin' }],
        headings: { pt: '🚨 Alerta de Estoque' },
        contents: { pt: `O item ${ingredienteNome} pode acabar em ${diasRestantes} dia(s). Veja a sugestão de compra no painel.` },
        android_sound: 'notification_sound',
        ios_sound: 'notification_sound.wav',
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn('[OneSignal] Push preditivo falhou:', res.status, txt);
    } else {
      console.log('[OneSignal] Push preditivo enviado:', ingredienteNome, diasRestantes);
    }
  } catch (e: any) {
    console.warn('[OneSignal] Erro preditivo:', e?.message || e);
  }
}

/**
 * Dispara push para clientes informando que o motoboy saiu para a rota.
 * Usa `include_external_user_ids` com o telefone normalizado como external_id.
 * Se o cliente não estiver inscrito, o OneSignal simplesmente ignora.
 */
export async function triggerOutForDeliveryPush(customerPhones: string[]): Promise<void> {
  try {
    const phones = Array.from(new Set(customerPhones
      .map(p => (p || '').replace(/\D/g, ''))
      .filter(p => p.length >= 8)));
    if (phones.length === 0) { console.warn('[OneSignal] Sem telefones válidos para rota.'); return; }

    const { data, error } = await supabase
      .from('system_settings' as any)
      .select('onesignal_app_id, onesignal_api_key')
      .eq('id', 'global')
      .maybeSingle();
    if (error) { console.warn('[OneSignal] Falha system_settings:', error.message); return; }

    const appId = (data as any)?.onesignal_app_id?.trim();
    const apiKey = (data as any)?.onesignal_api_key?.trim();
    if (!appId) { console.warn('[OneSignal] App ID ausente. Push de rota abortado.'); return; }

    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
    if (apiKey) headers['Authorization'] = `Basic ${apiKey}`;

    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        app_id: appId,
        include_external_user_ids: phones,
        channel_for_external_user_ids: 'push',
        headings: { pt: '🚀 Seu pedido saiu!' },
        contents: { pt: 'O motoboy já iniciou a rota de entregas do seu bairro e logo chegará até você.' },
        android_sound: 'notification_sound',
        ios_sound: 'notification_sound.wav',
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn('[OneSignal] Push rota falhou:', res.status, txt);
    } else {
      console.log('[OneSignal] Push de rota enviado para', phones.length, 'cliente(s).');
    }
  } catch (e: any) {
    console.warn('[OneSignal] Erro rota:', e?.message || e);
  }
}
