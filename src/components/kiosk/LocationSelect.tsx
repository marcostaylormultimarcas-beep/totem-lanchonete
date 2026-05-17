import { UtensilsCrossed, ShoppingBag, ArrowLeft, Ban } from 'lucide-react';

interface LocationSelectProps {
  onSelect: (type: 'local' | 'viagem') => void;
  onBack: () => void;
  deliveryEnabled?: boolean;
}

const LocationSelect = ({ onSelect, onBack, deliveryEnabled = true }: LocationSelectProps) => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 px-6">
      <button onClick={onBack} className="absolute top-6 left-6 text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-8 h-8" />
      </button>

      <h2 className="text-3xl md:text-4xl font-bold text-center">
        Onde você vai <span className="text-primary">comer?</span>
      </h2>

      <div className="flex flex-col sm:flex-row gap-6 w-full max-w-lg">
        <button
          onClick={() => onSelect('local')}
          className="kiosk-card flex-1 flex flex-col items-center gap-4 p-8 hover:bg-primary/10 active:scale-95 transition-all"
        >
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
            <UtensilsCrossed className="w-10 h-10 text-primary" />
          </div>
          <span className="text-xl font-bold">Comer no Local</span>
        </button>

        <button
          onClick={() => deliveryEnabled && onSelect('viagem')}
          disabled={!deliveryEnabled}
          className={`kiosk-card flex-1 flex flex-col items-center gap-4 p-8 transition-all relative ${
            deliveryEnabled
              ? 'hover:bg-primary/10 active:scale-95'
              : 'opacity-50 cursor-not-allowed'
          }`}
        >
          <div className="w-20 h-20 rounded-full bg-secondary/20 flex items-center justify-center">
            {deliveryEnabled ? (
              <ShoppingBag className="w-10 h-10 text-secondary" />
            ) : (
              <Ban className="w-10 h-10 text-muted-foreground" />
            )}
          </div>
          <span className="text-xl font-bold">Para Viagem</span>
          {!deliveryEnabled && (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Indisponível
            </span>
          )}
        </button>
      </div>

      {!deliveryEnabled && (
        <p className="max-w-md text-center text-sm text-muted-foreground bg-muted/40 border border-border rounded-xl px-4 py-3">
          As entregas por delivery estão temporariamente indisponíveis no momento. Você ainda pode fazer seu pedido para Retirada.
        </p>
      )}
    </div>
  );
};

export default LocationSelect;
