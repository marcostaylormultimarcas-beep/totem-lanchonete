from pathlib import Path
p=Path('src/pages/EntregadorDashboard.tsx')
s=p.read_text()
old="""  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (sendTimerRef.current !== null) {
      clearInterval(sendTimerRef.current);
      sendTimerRef.current = null;
    }
  }, []);
"""
new=old+"""
  const expireSession = useCallback(() => {
    stopTracking();
    clearEntregadorSession();
    toast.error('Sessão expirada. Faça login novamente.');
    navigate('/entregador/login', { replace: true });
  }, [navigate, stopTracking]);

  const isInvalidSession = (res: any) => res?.reason === 'invalid_session' || res?.reason === 'invalid_credentials';
"""
assert old in s
s=s.replace(old,new,1)
s=s.replace("""      await supabase.rpc('entregador_update_location_session' as any, {
        _session_token: session.session_token,
        _lat: p.lat,
        _lng: p.lng,
        _order_id: orderId,
      });
""","""      const { data } = await supabase.rpc('entregador_update_location_session' as any, {
        _session_token: session.session_token,
        _lat: p.lat,
        _lng: p.lng,
        _order_id: orderId,
      });
      if (isInvalidSession(data)) expireSession();
""",1)
s=s.replace("""      if (['invalid_credentials', 'invalid_session'].includes(res?.reason)) {
        clearEntregadorSession();
        navigate('/entregador/login');
      }
""","""      if (isInvalidSession(res)) expireSession();
""",1)
s=s.replace("""    if (!res?.ok) return;
    setMode((res.mode === 'free' ? 'free' : 'manual'));
""","""    if (!res?.ok) {
      if (isInvalidSession(res)) expireSession();
      return;
    }
    setMode((res.mode === 'free' ? 'free' : 'manual'));
""",1)
s=s.replace("""      toast.error(msg[res?.reason] || 'Não foi possível aceitar o pedido.');
      fetchAvailable();
""","""      toast.error(msg[res?.reason] || 'Não foi possível aceitar o pedido.');
      if (isInvalidSession(res)) { expireSession(); return; }
      fetchAvailable();
""",1)
s=s.replace("""      toast.error(msg[res?.reason] || 'Falha ao confirmar entrega.');
      return;
""","""      toast.error(msg[res?.reason] || 'Falha ao confirmar entrega.');
      if (isInvalidSession(res)) expireSession();
      return;
""",1)
p.write_text(s)
