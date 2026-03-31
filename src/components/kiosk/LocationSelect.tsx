import { UtensilsCrossed, ShoppingBag, ArrowLeft } from 'lucide-react';

interface LocationSelectProps {
  onSelect: (type: 'local' | 'viagem') => void;
  onBack: () => void;
}

const LocationSelect = ({ onSelect, onBack }: LocationSelectProps) => {
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
          onClick={() => onSelect('viagem')}
          className="kiosk-card flex-1 flex flex-col items-center gap-4 p-8 hover:bg-primary/10 active:scale-95 transition-all"
        >
          <div className="w-20 h-20 rounded-full bg-secondary/20 flex items-center justify-center">
            <ShoppingBag className="w-10 h-10 text-secondary" />
          </div>
          <span className="text-xl font-bold">Para Viagem</span>
        </button>
      </div>
    </div>
  );
};

export default LocationSelect;
