import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

interface SenhaRow {
  id: string;
  numero: string;
  tipo: string;
  called_at: string;
}

const playChime = () => {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const beep = (start: number, freq: number, dur = 0.18) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + start);
      g.gain.exponentialRampToValueAtTime(0.45, now + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      o.connect(g).connect(ctx.destination);
      o.start(now + start);
      o.stop(now + start + dur + 0.05);
    };
    beep(0, 1175);
    beep(0.22, 1568);
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {}
};

const PainelSenhas = () => {
  const { slug } = useParams<{ slug: string }>();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState('');
  const [senhas, setSenhas] = useState<SenhaRow[]>([]);
  const [flash, setFlash] = useState(false);
  const [now, setNow] = useState(new Date());
  const [audioReady, setAudioReady] = useState(false);
  const lastIdRef = useRef<string | null>(null);

  // Relógio
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Cursor auto-hide (modo TV)
  useEffect(() => {
    let timer: any;
    const move = () => {
      document.body.style.cursor = 'default';
      clearTimeout(timer);
      timer = setTimeout(() => { document.body.style.cursor = 'none'; }, 3000);
    };
    move();
    window.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('mousemove', move);
      clearTimeout(timer);
      document.body.style.cursor = 'default';
    };
  }, []);

  // Resolve org pelo slug
  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data } = await supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle();
      if (data) { setOrgId(data.id); setStoreName(data.name); }
    })();
  }, [slug]);

  // Carrega últimas + realtime
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

    const channel = supabase
      .channel(`senhas-${orgId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'senhas_chamadas', filter: `organization_id=eq.${orgId}` },
        (payload: any) => {
          const novo = payload.new as SenhaRow;
          if (lastIdRef.current === novo.id) return;
          lastIdRef.current = novo.id;
          setSenhas(prev => [novo, ...prev].slice(0, 5));
          setFlash(true);
          playChime();
          setTimeout(() => setFlash(false), 1200);
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  const atual = senhas[0];
  const anteriores = senhas.slice(1, 5);

  // Web Audio precisa de gesto do usuário (autoplay policy)
  if (!audioReady) {
    return (
      <div className="h-screen w-screen bg-zinc-950 flex items-center justify-center text-center px-6">
        <button
          onClick={() => { setAudioReady(true); playChime(); }}
          className="px-10 py-6 rounded-2xl bg-gradient-to-b from-amber-500 to-orange-600 text-white font-black text-2xl tracking-wider shadow-[0_0_30px_rgba(245,158,11,0.6)] border border-amber-400">
          TOQUE PARA ATIVAR O PAINEL
          <div className="text-sm font-medium opacity-90 mt-2">(necessário para liberar o som)</div>
        </button>
      </div>
    );
  }

  return (
    <div className="painel-shell h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden relative flex flex-col">
      <style>{`
        html, body { overflow: hidden !important; }
        @keyframes senhaFlash { 0%,100%{ background-color: rgba(245,158,11,0); } 50%{ background-color: rgba(245,158,11,0.25); } }
        .flash { animation: senhaFlash 0.4s ease-in-out 3; }
        @keyframes senhaPulse { 0%,100%{ transform: scale(1); text-shadow: 0 0 40px rgba(245,158,11,0.6), 0 0 80px rgba(245,158,11,0.4); } 50%{ transform: scale(1.04); text-shadow: 0 0 60px rgba(245,158,11,0.9), 0 0 120px rgba(245,158,11,0.6); } }
        .pulse-num { animation: senhaPulse 0.6s ease-in-out 3; }
      `}</style>

      {/* Glow ambient */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-amber-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full bg-orange-600/10 blur-3xl" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-10 py-5 border-b border-zinc-900/80">
        <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-wide">
          {storeName || 'Painel de Senhas'}
        </h1>
        <div className="text-amber-400 font-mono text-2xl md:text-3xl font-bold tabular-nums">
          {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </header>

      {/* Conteúdo principal */}
      <main className={`relative z-10 flex-1 grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-6 md:gap-10 px-6 md:px-10 py-6 ${flash ? 'flash' : ''}`}>
        {/* Senha atual */}
        <section className="flex flex-col items-center justify-center text-center">
          <div className="text-zinc-500 uppercase tracking-[0.5em] text-base md:text-xl font-bold mb-4">
            Senha Atual
          </div>
          {atual ? (
            <>
              <div className={`text-amber-500 font-black leading-none tracking-tight pulse-num`}
                style={{ fontSize: 'clamp(8rem, 22vw, 22rem)' }}>
                {atual.numero}
              </div>
              {atual.tipo === 'preferencial' && (
                <div className="mt-6 px-6 py-2 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold tracking-widest uppercase text-lg">
                  Preferencial
                </div>
              )}
            </>
          ) : (
            <div className="text-zinc-700 font-black" style={{ fontSize: 'clamp(6rem, 16vw, 16rem)' }}>
              —
            </div>
          )}
        </section>

        {/* Últimas senhas */}
        <aside className="flex flex-col bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 md:p-8 backdrop-blur-sm">
          <div className="text-zinc-500 uppercase tracking-[0.3em] text-sm md:text-base font-bold mb-6 text-center">
            Últimas Chamadas
          </div>
          <div className="flex-1 flex flex-col gap-4 justify-center">
            {anteriores.length === 0 && (
              <div className="text-zinc-700 text-center text-2xl">—</div>
            )}
            {anteriores.map((s) => (
              <div key={s.id}
                className="flex items-baseline justify-between px-5 py-3 rounded-2xl bg-zinc-950/60 border border-zinc-800/80">
                <span className="text-zinc-400 font-black tracking-tight"
                  style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)' }}>
                  {s.numero}
                </span>
                <span className="text-zinc-600 font-mono text-base md:text-lg tabular-nums">
                  {new Date(s.called_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-10 py-3 border-t border-zinc-900/80 text-center text-zinc-600 text-xs md:text-sm tracking-widest uppercase">
        Painel em tempo real · {storeName}
      </footer>
    </div>
  );
};

export default PainelSenhas;
