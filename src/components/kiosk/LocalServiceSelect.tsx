import { ArrowLeft, Store, UtensilsCrossed } from 'lucide-react';

interface LocalServiceSelectProps {
  onBalcony: () => void;
  onTable: () => void;
  onBack: () => void;
  tableLabel?: string;
  manualTableSelectionEnabled?: boolean;
}

const LocalServiceSelect = ({
  onBalcony,
  onTable,
  onBack,
  tableLabel = '',
  manualTableSelectionEnabled = false,
}: LocalServiceSelectProps) => (
  <div className="min-h-screen bg-background flex flex-col">
    <div className="flex items-center gap-4 p-4 border-b border-border">
      <button onClick={onBack} className="text-muted-foreground hover:text-foreground" aria-label="Voltar">
        <ArrowLeft className="w-7 h-7" />
      </button>
      <div>
        <h2 className="text-xl font-black">Comer no Local</h2>
        <p className="text-xs text-muted-foreground">Onde você quer receber seu pedido?</p>
      </div>
    </div>

    <div className="flex-1 px-5 py-8 max-w-2xl mx-auto w-full space-y-4">
      <button
        onClick={onBalcony}
        className="touch-btn w-full rounded-2xl border-2 border-border bg-card p-5 text-left flex items-center gap-4 hover:border-primary transition"
      >
        <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
          <Store className="w-7 h-7 text-primary" />
        </div>
        <div>
          <p className="text-lg font-black">Retirar no Balcão</p>
          <p className="text-sm text-muted-foreground">Aguarde sua senha ser chamada.</p>
        </div>
      </button>

      <button
        onClick={onTable}
        className="touch-btn w-full rounded-2xl border-2 border-border bg-card p-5 text-left flex items-center gap-4 hover:border-primary transition"
      >
        <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
          <UtensilsCrossed className="w-7 h-7 text-primary" />
        </div>
        <div>
          <p className="text-lg font-black">Receber na Mesa</p>
          <p className="text-sm text-muted-foreground">
            {tableLabel
              ? `Mesa identificada: ${tableLabel}`
              : manualTableSelectionEnabled
                ? 'Escolha sua mesa na próxima tela.'
                : 'No celular, use o QR disponível na mesa para identificá-la com segurança.'}
          </p>
        </div>
      </button>

      {!manualTableSelectionEnabled && !tableLabel && (
        <p className="text-xs text-muted-foreground text-center px-4">
          A lista manual de mesas fica disponível no totem físico autenticado. O QR da mesa continua funcionando no celular.
        </p>
      )}
    </div>
  </div>
);

export default LocalServiceSelect;
