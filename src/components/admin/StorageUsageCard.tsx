import { useEffect, useState, useCallback } from 'react';
import { HardDrive, Loader2, AlertTriangle } from 'lucide-react';
import { getOrgStorageUsage, STORAGE_LIMIT_BYTES } from '@/lib/imageUpload';
import { supabase } from '@/integrations/supabase/client';
import { BRAND_LEGAL_NAME } from '@/config/brandConfig';

const formatMB = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

interface Props {
  organizationId: string | null;
  refreshKey?: number; // mude para forçar refetch após upload
}

const StorageUsageCard = ({ organizationId, refreshKey = 0 }: Props) => {
  const [used, setUsed] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!organizationId) { setUsed(0); setLoading(false); return; }
    setLoading(true);
    const total = await getOrgStorageUsage(organizationId);
    setUsed(total);
    setLoading(false);
  }, [organizationId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Realtime: refetch após qualquer alteração em produtos/settings (sinal indireto de upload)
  useEffect(() => {
    if (!organizationId) return;
    const ch = supabase
      .channel(`storage-usage-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `organization_id=eq.${organizationId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `organization_id=eq.${organizationId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [organizationId, load]);

  const limitMB = STORAGE_LIMIT_BYTES / (1024 * 1024);
  const pct = Math.min(100, (used / STORAGE_LIMIT_BYTES) * 100);
  const isWarn = pct >= 80 && pct < 100;
  const isFull = pct >= 100;

  return (
    <div className="kiosk-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-primary" /> Armazenamento do Cardápio
        </h3>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="space-y-1.5">
        <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isFull ? 'bg-destructive' : isWarn ? 'bg-yellow-500' : 'bg-primary'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            <span className="text-foreground font-semibold">{formatMB(used)} MB</span> / {limitMB.toFixed(0)} MB utilizados
          </span>
          <span className={`font-semibold ${isFull ? 'text-destructive' : isWarn ? 'text-yellow-500' : 'text-primary'}`}>
            {pct.toFixed(1)}%
          </span>
        </div>
      </div>
      {isFull && (
        <p className="text-[11px] text-destructive flex items-start gap-1 leading-snug">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Limite atingido. Fale com a {BRAND_LEGAL_NAME} para expandir seu plano.
        </p>
      )}
    </div>
  );
};

export default StorageUsageCard;
