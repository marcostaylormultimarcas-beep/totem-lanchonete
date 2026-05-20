import { ReactNode, useState } from 'react';
import { Lock, Sparkles, X } from 'lucide-react';
import { usePlanFeatures } from '@/hooks/usePlanFeatures';

interface FeatureGateProps {
  feature: string;
  label?: string;
  children: ReactNode;
  /** Quando true, esconde o conteúdo completamente em vez de mostrar overlay. */
  hideWhenLocked?: boolean;
  /** Modo "inline": para botões — substitui por um botão "Bloqueado" do mesmo tamanho. */
  inline?: boolean;
}

/**
 * Envolve qualquer área/botão e bloqueia o acesso se a funcionalidade não estiver
 * liberada no plano da loja atual. Ao clicar, mostra modal de upgrade.
 */
export const FeatureGate = ({ feature, label, children, hideWhenLocked, inline }: FeatureGateProps) => {
  const { has, loading, planKey } = usePlanFeatures();
  const [showUpgrade, setShowUpgrade] = useState(false);

  if (loading) return <>{children}</>;
  if (has(feature)) return <>{children}</>;
  if (hideWhenLocked) return null;

  if (inline) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowUpgrade(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted text-muted-foreground border border-border text-sm font-semibold hover:bg-muted/70"
          title="Bloqueado pelo seu plano"
        >
          <Lock className="w-4 h-4" />
          {label || 'Bloqueado'}
        </button>
        {showUpgrade && <UpgradeModal feature={label || feature} planKey={planKey} onClose={() => setShowUpgrade(false)} />}
      </>
    );
  }

  return (
    <div className="relative">
      <div className="pointer-events-none opacity-40 blur-[1px] select-none">{children}</div>
      <button
        type="button"
        onClick={() => setShowUpgrade(true)}
        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-sm rounded-xl border-2 border-dashed border-primary/40 hover:bg-background/85 transition"
      >
        <div className="w-12 h-12 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center">
          <Lock className="w-6 h-6 text-primary" />
        </div>
        <p className="text-sm font-bold">{label || 'Funcionalidade bloqueada'}</p>
        <p className="text-xs text-muted-foreground px-4 text-center max-w-xs">
          Faça upgrade para o Plano Premium e desbloqueie este recurso.
        </p>
      </button>
      {showUpgrade && <UpgradeModal feature={label || feature} planKey={planKey} onClose={() => setShowUpgrade(false)} />}
    </div>
  );
};

const UpgradeModal = ({ feature, planKey, onClose }: { feature: string; planKey: string | null; onClose: () => void }) => (
  <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
    <div className="relative max-w-md w-full kiosk-card p-6 border-2 border-primary/40" onClick={e => e.stopPropagation()}>
      <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-muted">
        <X className="w-4 h-4" />
      </button>
      <div className="w-16 h-16 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-black text-center mb-2">Upgrade para Premium</h2>
      <p className="text-sm text-muted-foreground text-center mb-4">
        A funcionalidade <strong className="text-foreground">{feature}</strong> não está incluída no seu plano atual
        {planKey && <> (<span className="uppercase">{planKey}</span>)</>}.
      </p>
      <div className="bg-muted/40 rounded-lg p-4 space-y-2 text-sm mb-5">
        <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Todas as funcionalidades liberadas</div>
        <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Suporte prioritário</div>
        <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Atualizações antecipadas</div>
      </div>
      <button
        onClick={onClose}
        className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold hover:opacity-90"
      >
        Fazer Upgrade
      </button>
    </div>
  </div>
);

export default FeatureGate;
