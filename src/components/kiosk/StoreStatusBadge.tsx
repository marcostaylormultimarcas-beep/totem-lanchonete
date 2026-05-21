import { Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useStoreStatus } from '@/hooks/useStoreStatus';

const fmtTime = (d: Date | null) => {
  if (!d) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `hoje às ${time}`;
  return d.toLocaleDateString('pt-BR', { weekday: 'short' }) + ' às ' + time;
};

const StoreStatusBadge = ({ orgId, compact = false }: { orgId: string | null; compact?: boolean }) => {
  const s = useStoreStatus(orgId);
  if (s.loading) return null;

  if (s.open) {
    if (s.closingSoon) {
      return (
        <div className={`flex items-center gap-2 rounded-lg ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} bg-yellow-500/10 border border-yellow-500/40 text-yellow-500`}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="font-semibold">Atenção, fechamos em {s.minutesUntilClose} min</span>
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-2 rounded-lg ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} bg-success/10 border border-success/40 text-success`}>
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span className="font-semibold">Aberto agora</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} bg-destructive/10 border border-destructive/40 text-destructive`}>
      <Clock className="w-4 h-4 shrink-0" />
      <span className="font-semibold">
        Fechado{s.nextOpenAt ? ` · abre ${fmtTime(s.nextOpenAt)}` : ''}
      </span>
    </div>
  );
};

export default StoreStatusBadge;
