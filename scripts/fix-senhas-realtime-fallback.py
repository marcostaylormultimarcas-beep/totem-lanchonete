from pathlib import Path
p=Path('src/pages/PainelSenhas.tsx')
s=p.read_text()
old="""  // Carrega últimas + realtime
  useEffect(() => {
    if (!orgId) return;
    const load = async () => {
      const { data } = await supabase
        .from('senhas_chamadas')
        .select('id, numero, tipo, called_at')
        .eq('organization_id', orgId)
        .order('called_at', { ascending: false })
        .limit(5);
      if (data) {
        setSenhas(data as SenhaRow[]);
        if (data[0]) lastIdRef.current = data[0].id;
      }
    };
    load();

    const channel = supabase"""
new="""  // Carrega últimas + realtime. Polling leve funciona como fallback caso a TV perca o canal Realtime.
  useEffect(() => {
    if (!orgId) return;
    const load = async (notifyNew = false) => {
      const { data, error } = await supabase
        .from('senhas_chamadas')
        .select('id, numero, tipo, called_at')
        .eq('organization_id', orgId)
        .order('called_at', { ascending: false })
        .limit(5);
      if (error || !data) return;
      const latest = data[0] as SenhaRow | undefined;
      const isNew = Boolean(notifyNew && latest && lastIdRef.current && latest.id !== lastIdRef.current);
      setSenhas(data as SenhaRow[]);
      if (latest) lastIdRef.current = latest.id;
      if (isNew) {
        setFlash(true);
        playChime();
        setTimeout(() => setFlash(false), 1200);
      }
    };
    load(false);
    const fallbackPoll = window.setInterval(() => load(true), 5000);

    const channel = supabase"""
if s.count(old)!=1: raise SystemExit(f'load guard failed: {s.count(old)}')
s=s.replace(old,new,1)
old="""    return () => { supabase.removeChannel(channel); };
  }, [orgId]);"""
new="""    return () => {
      window.clearInterval(fallbackPoll);
      supabase.removeChannel(channel);
    };
  }, [orgId]);"""
if s.count(old)!=1: raise SystemExit(f'cleanup guard failed: {s.count(old)}')
s=s.replace(old,new,1)
p.write_text(s)
print('senhas realtime fallback patch applied')
