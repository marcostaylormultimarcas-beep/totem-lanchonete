import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const appIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ ok: false, reason: 'unauthorized' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey =
      Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ??
      Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: currentRaw, error: currentError } = await userClient.rpc(
      'onesignal_admin_config' as any,
    );
    const current: any = currentRaw;

    if (currentError || !current?.ok) {
      return new Response(
        JSON.stringify({ ok: false, reason: 'forbidden' }),
        { status: 403, headers: corsHeaders },
      );
    }

    const body = await req.json().catch(() => ({}));
    const appId = String(body?.app_id ?? '').trim();
    const apiKey = String(body?.api_key ?? '').trim();

    if (appId && !appIdPattern.test(appId)) {
      return new Response(
        JSON.stringify({ ok: false, valid: false, reason: 'invalid_app_id' }),
        { headers: corsHeaders },
      );
    }

    if (apiKey && (apiKey.length < 20 || apiKey.length > 1000)) {
      return new Response(
        JSON.stringify({ ok: false, valid: false, reason: 'invalid_api_key' }),
        { headers: corsHeaders },
      );
    }

    // Disabling OneSignal does not require an external credential check.
    if (!appId) {
      const { data, error } = await admin.rpc('set_onesignal_config' as any, {
        _app_id: '',
        _api_key: null,
      });
      const result: any = data;

      if (error || !result?.ok) {
        return new Response(
          JSON.stringify({ ok: false, reason: result?.reason || 'save_failed' }),
          { status: 500, headers: corsHeaders },
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          valid: true,
          saved: true,
          app_id: result.app_id,
          has_api_key: Boolean(result.has_api_key),
        }),
        { headers: corsHeaders },
      );
    }

    // Keeping the same App ID without replacing the key is a no-op. We never
    // expose the stored secret to the browser only to revalidate it.
    if (!apiKey) {
      if (appId !== String(current.app_id || '').trim()) {
        return new Response(
          JSON.stringify({
            ok: false,
            valid: false,
            reason: 'api_key_required_for_app_change',
          }),
          { headers: corsHeaders },
        );
      }

      if (!current.has_api_key) {
        return new Response(
          JSON.stringify({
            ok: false,
            valid: false,
            reason: 'api_key_required',
          }),
          { headers: corsHeaders },
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          valid: true,
          saved: false,
          app_id: appId,
          has_api_key: true,
        }),
        { headers: corsHeaders },
      );
    }

    // App API Keys are app-scoped. Listing one notification is a read-only
    // credential probe: 200 proves this key is authorized for this App ID.
    let validationResponse: Response;
    try {
      validationResponse = await fetch(
        `https://api.onesignal.com/notifications?app_id=${encodeURIComponent(appId)}&limit=1`,
        {
          method: 'GET',
          headers: {
            Authorization: `Key ${apiKey}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(7000),
        },
      );
    } catch (error) {
      console.error('onesignal credential validation unavailable', error);
      return new Response(
        JSON.stringify({
          ok: false,
          valid: false,
          reason: 'validation_unavailable',
        }),
        { headers: corsHeaders },
      );
    }

    if (validationResponse.status !== 200) {
      return new Response(
        JSON.stringify({
          ok: false,
          valid: false,
          reason:
            validationResponse.status === 401 || validationResponse.status === 403
              ? 'credential_mismatch'
              : 'credential_validation_failed',
          status: validationResponse.status,
        }),
        { headers: corsHeaders },
      );
    }

    const { data, error } = await admin.rpc('set_onesignal_config' as any, {
      _app_id: appId,
      _api_key: apiKey,
    });
    const result: any = data;

    if (error || !result?.ok) {
      console.error('set_onesignal_config', error || result);
      return new Response(
        JSON.stringify({ ok: false, reason: result?.reason || 'save_failed' }),
        { status: 500, headers: corsHeaders },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        valid: true,
        saved: true,
        app_id: result.app_id,
        has_api_key: Boolean(result.has_api_key),
      }),
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error('onesignal-validate', error);
    return new Response(
      JSON.stringify({
        ok: false,
        valid: false,
        reason: 'internal_error',
      }),
      { status: 500, headers: corsHeaders },
    );
  }
});
