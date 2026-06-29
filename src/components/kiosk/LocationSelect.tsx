import { ArrowLeft, ArrowRight, ShoppingCart, ShieldCheck, Ban, Bike } from 'lucide-react';
import { useState } from 'react';
import iconComerLocal from '@/assets/icon-comer-local.png';
import iconParaViagem from '@/assets/icon-para-viagem.png';

type Mode = 'local' | 'viagem' | 'delivery';

interface LocationSelectProps {
  onSelect: (type: Mode) => void;
  onBack: () => void;
  deliveryEnabled?: boolean;
  cartCount?: number;
  onGoToCart?: () => void;
}

const LocationSelect = ({ onSelect, onBack, deliveryEnabled = true, cartCount = 0, onGoToCart }: LocationSelectProps) => {
  const [hovered, setHovered] = useState<Mode | null>(null);

  const Card = ({
    type, title, desc, icon, iconNode, disabled,
  }: { type: Mode; title: string; desc: string; icon?: string; iconNode?: React.ReactNode; disabled?: boolean }) => {
    const active = hovered === type;
    return (
      <button
        onClick={() => !disabled && onSelect(type)}
        onMouseEnter={() => setHovered(type)}
        onMouseLeave={() => setHovered(null)}
        disabled={disabled}
        className={[
          'group relative w-full text-left rounded-3xl p-5 sm:p-6 transition-all duration-300',
          'bg-[#18181B] border',
          disabled
            ? 'opacity-50 cursor-not-allowed border-zinc-800'
            : active
              ? 'border-orange-500 shadow-[0_0_40px_-8px_rgba(255,122,0,0.55)] scale-[1.01]'
              : 'border-zinc-800/80 hover:border-orange-500/60 active:scale-[0.99]',
        ].join(' ')}
        style={{ boxShadow: !disabled && active ? undefined : '0 10px 30px -15px rgba(0,0,0,0.6)' }}
      >
        <div className="flex items-center gap-4 sm:gap-5">
          <div className="relative shrink-0 w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center">
            <div className={`absolute inset-0 rounded-2xl blur-2xl transition-opacity duration-300 ${active && !disabled ? 'opacity-60' : 'opacity-0'} bg-orange-500/40`} />
            {iconNode ? (
              <div className="relative w-full h-full flex items-center justify-center text-orange-500">{iconNode}</div>
            ) : (
              <img
                src={icon}
                alt=""
                loading="lazy"
                width={256}
                height={256}
                className="relative w-full h-full object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,0.6)]"
              />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-white font-bold text-xl sm:text-2xl tracking-tight font-[Inter]">{title}</h3>
            <p className="text-zinc-400 text-sm sm:text-[15px] mt-1.5 leading-snug">{desc}</p>
            {disabled && (
              <span className="inline-flex items-center gap-1 mt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <Ban className="w-3 h-3" /> Indisponível
              </span>
            )}
          </div>

          <div
            className={[
              'shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-full border flex items-center justify-center transition-all duration-300',
              active && !disabled
                ? 'border-orange-500 bg-orange-500 text-black'
                : 'border-orange-500/60 text-orange-500 bg-transparent',
            ].join(' ')}
          >
            <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="min-h-screen w-full bg-[#0B0B0D] font-[Inter] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-5 sm:px-8 sm:pt-7">
        <button
          onClick={onBack}
          aria-label="Voltar"
          className="w-11 h-11 rounded-2xl bg-[#18181B] border border-zinc-800 flex items-center justify-center text-white hover:border-orange-500/50 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-1.5 select-none">
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" aria-hidden>
            <path d="M4 4 L12 20 L20 4 L15 4 L12 12 L9 4 Z" fill="#FF7A00" />
          </svg>
          <span className="text-white font-bold text-lg tracking-tight">
            Vision<span className="text-orange-500">Food</span>
          </span>
        </div>

        <button
          onClick={onGoToCart}
          aria-label="Carrinho"
          className="relative w-11 h-11 rounded-2xl bg-[#18181B] border border-zinc-800 flex items-center justify-center text-white hover:border-orange-500/50 transition-colors"
        >
          <ShoppingCart className="w-5 h-5" />
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-orange-500 ring-2 ring-[#0B0B0D]" />
          )}
        </button>
      </header>

      {/* Title */}
      <div className="px-6 sm:px-8 mt-8 sm:mt-10">
        <h1 className="text-white font-extrabold text-[34px] sm:text-5xl leading-[1.05] tracking-tight">
          Como você quer<br />
          <span className="text-orange-500">receber seu pedido?</span>
        </h1>
        <p className="text-zinc-400 text-sm sm:text-base mt-3">
          Escolha a opção que melhor combina com você.
        </p>
      </div>

      {/* Cards */}
      <div className="flex-1 flex flex-col gap-5 px-5 sm:px-8 mt-8 sm:mt-10 max-w-2xl w-full mx-auto">
        <Card
          type="local"
          title="Comer no Local"
          desc="Aproveite seu pedido em nosso ambiente."
          icon={iconComerLocal}
        />
        <Card
          type="viagem"
          title="Para Viagem"
          desc="Leve seu pedido para onde quiser."
          icon={iconParaViagem}
          disabled={!deliveryEnabled}
        />

        {!deliveryEnabled && (
          <p className="text-center text-xs text-zinc-500 bg-[#18181B]/60 border border-zinc-800 rounded-xl px-4 py-3">
            As entregas estão temporariamente indisponíveis. Você ainda pode comer no local.
          </p>
        )}
      </div>

      {/* Footer */}
      <footer className="px-6 sm:px-8 py-7 sm:py-9 flex items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#18181B] border border-zinc-800 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-orange-500" />
        </div>
        <p className="text-zinc-500 text-xs sm:text-sm leading-snug max-w-[260px]">
          Seu pedido é preparado com todo cuidado e segurança.
        </p>
      </footer>
    </div>
  );
};

export default LocationSelect;
