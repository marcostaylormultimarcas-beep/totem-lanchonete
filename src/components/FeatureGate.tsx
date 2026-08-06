import { ReactNode } from 'react';

interface FeatureGateProps {
  feature: string;
  label?: string;
  children: ReactNode;
  hideWhenLocked?: boolean;
  inline?: boolean;
}

/**
 * Paywall removido: todos os recursos estão liberados para todas as organizações.
 * Este componente agora apenas renderiza o conteúdo, sem bloqueios ou pop-ups.
 */
export const FeatureGate = ({ children }: FeatureGateProps) => <>{children}</>;

export default FeatureGate;
