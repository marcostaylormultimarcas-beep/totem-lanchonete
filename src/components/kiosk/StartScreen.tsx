import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { getSettings } from '@/data/store';
import kioskBg from '@/assets/kiosk-bg.jpg';

interface StartScreenProps {
  onStart: () => void;
}

const StartScreen = ({ onStart }: StartScreenProps) => {
  const settings = getSettings();
  const storeName = settings.storeName || 'Vision Mídia';
  const bgImage = settings.coverImage || kioskBg;
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-end overflow-hidden">
      <img
        src={bgImage}
        alt="Bem-vindo"
        className="absolute inset-0 w-full h-full object-cover"
        width={1080}
        height={1920}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />

      <div className="relative z-10 flex flex-col items-center gap-6 pb-20 px-6 text-center">
        <h1 className="text-4xl md:text-6xl font-black tracking-tight">
          <span className="text-primary">{storeName.split(' ')[0]}</span>{' '}
          <span className="text-foreground">{storeName.split(' ').slice(1).join(' ')}</span>
        </h1>
        <p className="text-muted-foreground text-lg">Faça seu pedido de forma rápida e fácil</p>

        <button
          onClick={onStart}
          className="touch-btn bg-primary text-primary-foreground px-16 py-6 text-2xl font-black rounded-2xl pulse-glow mt-4"
        >
          TOQUE PARA INICIAR
        </button>
      </div>

      {/* Admin access button */}
      <Link
        to="/admin"
        className="absolute top-4 right-4 z-20 p-3 rounded-full bg-background/30 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-background/60 transition-all"
        title="Painel Administrativo"
      >
        <Settings className="w-5 h-5" />
      </Link>
    </div>
  );
};

export default StartScreen;
