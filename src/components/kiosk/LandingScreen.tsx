import { getSettings } from '@/data/store';

interface LandingScreenProps {
  onStart: () => void;
}

const LandingScreen = ({ onStart }: LandingScreenProps) => {
  const settings = getSettings();

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center relative cursor-pointer select-none"
      onClick={onStart}
      style={{
        backgroundImage: `url('https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=1920&q=80')`,
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
          {settings.storeName || 'BurgerBox'}
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
