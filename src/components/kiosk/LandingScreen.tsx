import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrgId } from '@/contexts/OrgContext';

interface LandingScreenProps {
  onStart: () => void;
}

const LandingScreen = ({ onStart }: LandingScreenProps) => {
  const orgId = useOrgId();
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


  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center relative cursor-pointer select-none"
      onClick={onStart}
      style={{
        backgroundImage: `url('${coverImage}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8 md:gap-12 px-6 text-center">
        {/* Store name */}
        <h1 className="text-3xl md:text-5xl lg:text-6xl font-black text-primary-foreground drop-shadow-lg">
          {storeName || 'BurgerBox'}
        </h1>

        {/* Pulsing CTA */}
        <div className="pulse-glow rounded-2xl bg-primary/90 backdrop-blur-sm px-8 py-6 md:px-14 md:py-10">
          <span className="text-xl md:text-3xl lg:text-4xl font-extrabold text-primary-foreground tracking-wide">
            TOQUE PARA INICIAR
          </span>
          <p className="text-sm md:text-lg text-primary-foreground/80 mt-2 font-medium">
            SEU PEDIDO
          </p>
        </div>

        <p className="text-muted-foreground text-xs md:text-sm animate-pulse">
          Toque em qualquer lugar da tela
        </p>
      </div>
    </div>
  );
};

export default LandingScreen;
