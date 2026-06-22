/** Utilidades de Controle de Validade (Dark Premium). */

/** Calcula dias restantes até a data informada (negativo = vencido). */
export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/** Retorna severidade para destaque visual. */
export type VencimentoStatus = 'ok' | 'proximo' | 'vencido';

export function vencimentoStatus(dateStr?: string | null, threshold = 7): VencimentoStatus {
  const days = daysUntil(dateStr);
  if (days === null) return 'ok';
  if (days < 0) return 'vencido';
  if (days <= threshold) return 'proximo';
  return 'ok';
}

export function vencimentoLabel(dateStr?: string | null): string {
  const days = daysUntil(dateStr);
  if (days === null) return '';
  if (days < 0) return `Vencido há ${Math.abs(days)}d`;
  if (days === 0) return 'Vence hoje';
  if (days === 1) return 'Vence amanhã';
  return `Vence em ${days}d`;
}
