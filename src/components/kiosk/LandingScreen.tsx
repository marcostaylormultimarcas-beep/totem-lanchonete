import { useState, useEffect } from 'react';
import { Clock, Lock, Crown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrgId } from '@/contexts/OrgContext';
import { useStoreStatus } from '@/hooks/useStoreStatus';

interface LandingScreenProps {
  onStart: () => void;
}

const fmtTime = (d: Date | null) => {
  if (!d) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `hoje às ${time}` : d.toLocaleDateString('pt-BR', { weekday: 'short' }) + ' às ' + time;
};

const LandingScreen = ({ onStart }: LandingScreenProps) => {
  const orgId = useOrgId();
  const status = useStoreStatus(orgId);
  const [storeName, setStoreName] = useState('Vision Mídia');

  useEffect(() => {
    if (!orgId) return;
    const fetchSettings = async () => {
      const { data } = await supabase.from('settings').select('store_name').eq('organization_id', orgId).maybeSingle();
      if (data?.store_name) setStoreName(data.store_name);
    };
    fetchSettings();

    const channel = supabase
      .channel('landing-settings-' + orgId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `organization_id=eq.${orgId}` }, (payload: any) => {
        const d = payload.new;
        if (d?.store_name) setStoreName(d.store_name);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  const canOrder = status.open || status.schedulingEnabled;
  const isClosed = !status.open;
  const allowClick = canOrder && !status.loading;

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=${encodeURIComponent(currentUrl)}`;

  return (
    <div
      className={`landing-shell min-h-screen w-full flex flex-col items-center justify-between bg-zinc-950 px-6 py-10 select-none relative overflow-hidden ${allowClick ? 'cursor-pointer' : 'cursor-not-allowed'}`}
      onClick={() => allowClick && onStart()}
    >
      {/* Scoped style to prevent any dark-mode image inversion (QR + logos must keep original colors) */}
      <style>{`
        .landing-shell img { filter:none !important; mix-blend-mode:normal !important; opacity:1 !important; -webkit-filter:none !important; }
        .dark .landing-shell img, .landing-shell img.dark\\:invert { filter:none !important; }
      `}</style>

      {/* ambient glow */}
      <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[520px] h-[520px] rounded-full bg-amber-500/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 w-[420px] h-[300px] rounded-full bg-orange-600/10 blur-3xl" />

      {/* Header */}
      <div className="relative z-10 flex flex-col items-center gap-3 text-center">
        <Crown className="w-10 h-10 text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.6)]" strokeWidth={2.2} />
        <h1 className="text-3xl md:text-5xl font-extrabold text-amber-400 tracking-wide drop-shadow-[0_0_18px_rgba(245,158,11,0.35)]">
          FAÇA SEU PEDIDO!
        </h1>
        <p className="text-white font-medium text-lg md:text-xl">{storeName}</p>
        <p className="text-zinc-400 text-xs md:text-sm uppercase tracking-[0.3em]">Atendimento Premium</p>
      </div>

      {/* CTA + QR */}
      <div className="relative z-10 flex flex-col items-center gap-6 w-full max-w-sm">
        {canOrder ? (
          <button
            onClick={(e) => { e.stopPropagation(); allowClick && onStart(); }}
            className="w-full bg-gradient-to-b from-amber-500 to-orange-600 border border-amber-400 rounded-2xl p-6 shadow-[0_0_30px_rgba(245,158,11,0.6)] active:scale-[0.98] transition-transform"
          >
            <span className="block text-white font-black tracking-wider text-xl md:text-2xl text-center">
              {status.open ? 'TOQUE PARA INICIAR' : 'AGENDAR PEDIDO'}
            </span>
            <span className="block text-white/90 text-xs md:text-sm mt-2 font-semibold tracking-widest">
              {status.open ? 'SEU PEDIDO COMEÇA AQUI' : 'PARA QUANDO REABRIRMOS'}
            </span>
          </button>
        ) : (
          <div className="w-full rounded-2xl p-6 bg-zinc-900 border border-zinc-800 flex flex-col items-center gap-2">
            <Lock className="w-8 h-8 text-zinc-500" />
            <span className="text-lg font-extrabold text-zinc-300 tracking-wide">PEDIDOS INDISPONÍVEIS</span>
          </div>
        )}

        {/* QR Code */}
        <div className="flex flex-col items-center gap-2">
          <div className="bg-white rounded-2xl p-3 border-2 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)]">
            <img src={qrSrc} alt="QR Code do cardápio" className="w-32 h-32 md:w-36 md:h-36 block" />
          </div>
          <p className="text-zinc-400 text-[11px] uppercase tracking-[0.25em]">Aponte a câmera</p>
        </div>
      </div>

      {/* Footer status */}
      <div className="relative z-10 w-full max-w-sm">
        {!status.loading && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 flex items-center justify-center gap-3 backdrop-blur-sm">
            {status.open ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
                <span className="text-emerald-500 font-semibold text-sm">Aberto agora</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-amber-400 font-semibold text-sm">
                  {status.emergencyClosed ? status.message : 'Fechado agora'}
                  {status.nextOpenAt && !status.emergencyClosed ? ` · abre ${fmtTime(status.nextOpenAt)}` : ''}
                </span>
              </>
            )}
          </div>
        )}
        <p className="text-zinc-500 text-xs text-center mt-3 animate-pulse">
          {allowClick ? 'Toque em qualquer lugar da tela' : 'Aguarde a reabertura para fazer seu pedido'}
        </p>
      </div>
    </div>
  );
};

export default LandingScreen;
