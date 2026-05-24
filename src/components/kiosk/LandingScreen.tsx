import { useState, useEffect } from 'react';
import { Clock, Lock } from 'lucide-react';
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
  const [coverImage, setCoverImage] = useState('https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=1920&q=80');

  useEffect(() => {
    if (!orgId) return;
    const fetchSettings = async () => {
      const { data } = await supabase.from('settings').select('store_name, cover_image').eq('organization_id', orgId).maybeSingle();
      if (data?.store_name) setStoreName(data.store_name);
      if (data?.cover_image) setCoverImage(data.cover_image);
    };
    fetchSettings();

    const channel = supabase
      .channel('landing-settings-' + orgId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `organization_id=eq.${orgId}` }, (payload: any) => {
        const d = payload.new;
        if (d?.store_name) setStoreName(d.store_name);
        if (d?.cover_image) setCoverImage(d.cover_image);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  const canOrder = status.open || status.schedulingEnabled;
  const isClosed = !status.open;
  const allowClick = canOrder && !status.loading;

  return (
    <div
      className={`min-h-screen w-full flex flex-col items-center justify-center relative select-none ${allowClick ? 'cursor-pointer' : 'cursor-not-allowed'}`}
      onClick={() => allowClick && onStart()}
      style={{
        backgroundImage: `url('${coverImage}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/85" />

      <div className="relative z-10 flex flex-col items-center gap-6 md:gap-10 px-6 text-center">
        <h1 className="text-3xl md:text-5xl lg:text-6xl font-black text-primary-foreground drop-shadow-lg">
          {storeName || 'BurgerBox'}
        </h1>

        {/* Status badge */}
        {!status.loading && (
          isClosed ? (
            <div className="flex items-center gap-2 rounded-full px-4 py-2 bg-destructive/20 border border-destructive/60 text-destructive-foreground backdrop-blur-sm">
              <Clock className="w-4 h-4" />
              <span className="font-semibold text-sm">
                {status.emergencyClosed ? status.message : 'Fechado agora'}
                {status.nextOpenAt && !status.emergencyClosed ? ` · abre ${fmtTime(status.nextOpenAt)}` : ''}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full px-4 py-2 bg-success/20 border border-success/60 text-success-foreground backdrop-blur-sm">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="font-semibold text-sm">Aberto agora</span>
            </div>
          )
        )}

        {/* CTA */}
        {canOrder ? (
          <div className={`rounded-2xl bg-primary/90 backdrop-blur-sm px-8 py-6 md:px-14 md:py-10 ${status.open ? 'pulse-glow' : ''}`}>
            <span className="text-xl md:text-3xl lg:text-4xl font-extrabold text-primary-foreground tracking-wide">
              {status.open ? 'TOQUE PARA INICIAR' : 'AGENDAR PEDIDO'}
            </span>
            <p className="text-sm md:text-lg text-primary-foreground/80 mt-2 font-medium">
              {status.open ? 'SEU PEDIDO' : 'Para quando abrirmos'}
            </p>
          </div>
        ) : (
          <div className="rounded-2xl bg-muted/80 backdrop-blur-sm px-8 py-6 md:px-14 md:py-10 flex flex-col items-center gap-2">
            <Lock className="w-8 h-8 text-muted-foreground" />
            <span className="text-lg md:text-2xl font-extrabold text-muted-foreground tracking-wide">
              PEDIDOS INDISPONÍVEIS
            </span>
          </div>
        )}

        <p className="text-muted-foreground text-xs md:text-sm animate-pulse">
          {allowClick ? 'Toque em qualquer lugar da tela' : 'Aguarde a reabertura para fazer seu pedido'}
        </p>
      </div>
    </div>
  );
};

export default LandingScreen;
