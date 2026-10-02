from pathlib import Path
p=Path('src/pages/EntregadorDashboard.tsx')
s=p.read_text()
def rep(old,new,count=1):
    global s
    n=s.count(old)
    if n!=count: raise SystemExit(f'guard expected {count}, got {n}: {old[:100]!r}')
    s=s.replace(old,new,count)
rep("  const sendTimerRef = useRef<number | null>(null);\n  const lastSampleRef", "  const sendTimerRef = useRef<number | null>(null);\n  const initialSendTimerRef = useRef<number | null>(null);\n  const locationRequestInFlightRef = useRef(false);\n  const trackingGenerationRef = useRef(0);\n  const lastSampleRef")
rep("  const stopTracking = useCallback(() => {\n    if (watchIdRef.current", "  const stopTracking = useCallback(() => {\n    trackingGenerationRef.current += 1;\n    locationRequestInFlightRef.current = false;\n    if (initialSendTimerRef.current !== null) {\n      clearTimeout(initialSendTimerRef.current);\n      initialSendTimerRef.current = null;\n    }\n    if (watchIdRef.current")
rep("    stopTracking();\n    watchIdRef.current = navigator.geolocation.watchPosition(", "    stopTracking();\n    const trackingGeneration = trackingGenerationRef.current;\n    watchIdRef.current = navigator.geolocation.watchPosition(")
old="""    const send = async () => {
      const p = lastSampleRef.current;
      if (!p) return;
      const { data } = await supabase.rpc('entregador_update_location_session' as any, {
        _session_token: session.session_token,
        _lat: p.lat,
        _lng: p.lng,
        _order_id: orderId,
      });
      if (isInvalidSession(data)) expireSession();
    };
    sendTimerRef.current = window.setInterval(send, 15000);
    // primeiro envio rápido
    setTimeout(send, 2500);"""
new="""    const send = async () => {
      if (trackingGeneration !== trackingGenerationRef.current || locationRequestInFlightRef.current) return;
      const p = lastSampleRef.current;
      if (!p) return;
      locationRequestInFlightRef.current = true;
      try {
        const { data } = await supabase.rpc('entregador_update_location_session' as any, {
          _session_token: session.session_token,
          _lat: p.lat,
          _lng: p.lng,
          _order_id: orderId,
        });
        if (trackingGeneration !== trackingGenerationRef.current) return;
        if (isInvalidSession(data)) expireSession();
      } finally {
        if (trackingGeneration === trackingGenerationRef.current) locationRequestInFlightRef.current = false;
      }
    };
    sendTimerRef.current = window.setInterval(send, 15000);
    // primeiro envio rápido; cancelável ao fechar mapa/logout/expirar sessão
    initialSendTimerRef.current = window.setTimeout(() => {
      initialSendTimerRef.current = null;
      void send();
    }, 2500);"""
rep(old,new)
p.write_text(s)
print('driver location concurrency hardening applied')
