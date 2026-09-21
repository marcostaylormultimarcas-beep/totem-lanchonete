import { useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import { Copy, Plus, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  organizationId: string | null;
  orgSlug: string | null;
}

interface TableRow {
  id: string;
  label: string;
  public_token: string;
  active: boolean;
  open_session_id?: string | null;
  open_session_started_at?: string | null;
  open_orders?: number;
  open_total?: number;
}

const MesasPanel = ({ organizationId, orgSlug }: Props) => {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!organizationId) { setTables([]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('visionfood_admin_tables', { _org: organizationId });
      if (error) throw error;
      setTables((Array.isArray(data) ? data : []) as TableRow[]);
    } catch (error: any) {
      console.error('visionfood_admin_tables', error);
      toast.error('Não foi possível carregar as mesas.', { description: error?.message || '' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [organizationId]);

  const baseUrl = useMemo(() => {
    if (!orgSlug || typeof window === 'undefined') return '';
    return `${window.location.origin}/cardapio/${encodeURIComponent(orgSlug)}`;
  }, [orgSlug]);

  const tableUrl = (token: string) => `${baseUrl}?mesa=${encodeURIComponent(token)}`;

  const addTable = async () => {
    if (!organizationId || !label.trim()) return;
    const { data, error } = await supabase.rpc('visionfood_upsert_table', {
      _org: organizationId, _label: label.trim(), _table_id: null,
    });
    if (error || !(data as any)?.ok) {
      toast.error('Não foi possível criar a mesa.', { description: error?.message || '' });
      return;
    }
    setLabel('');
    toast.success('Mesa criada. O QR já pode ser usado.');
    await load();
  };

  const rotate = async (row: TableRow) => {
    if (!organizationId) return;
    if (!confirm(`Trocar o QR da ${row.label}? O QR anterior deixará de funcionar.`)) return;
    const { data, error } = await supabase.rpc('visionfood_rotate_table_token', {
      _org: organizationId, _table_id: row.id,
    });
    if (error || !(data as any)?.ok) {
      toast.error('Não foi possível trocar o QR.');
      return;
    }
    toast.success('QR da mesa trocado.');
    await load();
  };

  const closeSession = async (row: TableRow) => {
    if (!row.open_session_id) return;
    const { data, error } = await supabase.rpc('visionfood_close_table_session', {
      _session_id: row.open_session_id,
    });
    const result: any = data;
    if (error || !result?.ok) {
      if (result?.reason === 'open_orders') {
        toast.error('A mesa ainda possui pedidos abertos ou pagamento pendente.');
      } else {
        toast.error('Não foi possível fechar a mesa.', { description: error?.message || result?.reason || '' });
      }
      return;
    }
    toast.success('Mesa fechada. O próximo pedido abrirá uma nova sessão.');
    await load();
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success('Link copiado.');
  };

  return (
    <div className="px-4 space-y-4">
      <div className="kiosk-card p-4 space-y-3">
        <div>
          <h2 className="text-xl font-black">Mesas compartilhadas</h2>
          <p className="text-sm text-muted-foreground">
            Cada mesa usa um QR opaco. Pessoas diferentes fazem pedidos independentes, ligados à mesma sessão operacional da mesa.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            maxLength={40}
            placeholder="Ex.: Mesa 12"
            className="w-full min-w-0 bg-muted rounded-xl px-3 py-2 outline-none sm:flex-1"
          />
          <div className="flex gap-2">
            <button onClick={addTable} disabled={!organizationId || !label.trim()} className="touch-btn min-w-0 flex-1 px-4 py-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-50 sm:flex-none">
              <Plus className="w-4 h-4 inline mr-1" /> Criar
            </button>
            <button onClick={load} disabled={loading} className="touch-btn shrink-0 px-3 py-2 rounded-xl border" aria-label="Atualizar mesas" title="Atualizar mesas">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {!orgSlug && <div className="kiosk-card p-4 text-sm text-destructive">Slug da loja indisponível; não é possível montar os links das mesas.</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tables.map(row => {
          const url = baseUrl ? tableUrl(row.public_token) : '';
          return (
            <div key={row.id} className="kiosk-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-black text-lg">{row.label}</h3>
                  <p className="text-xs text-muted-foreground">
                    {row.open_session_id
                      ? `Sessão aberta · ${Number(row.open_orders || 0)} pedido(s)`
                      : 'Sem sessão aberta'}
                  </p>
                </div>
                {row.open_session_id && (
                  <button onClick={() => closeSession(row)} className="touch-btn text-xs px-2 py-1.5 rounded-lg border border-destructive/40 text-destructive">
                    <XCircle className="w-3.5 h-3.5 inline mr-1" /> Fechar
                  </button>
                )}
              </div>

              {url && (
                <div className="bg-white rounded-xl p-3 w-fit mx-auto">
                  <QRCode value={url} size={180} />
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => url && copy(url)} disabled={!url} className="flex-1 touch-btn px-3 py-2 rounded-xl border text-sm disabled:opacity-50">
                  <Copy className="w-4 h-4 inline mr-1" /> Copiar link
                </button>
                <button onClick={() => rotate(row)} className="touch-btn px-3 py-2 rounded-xl border text-sm" title="Invalidar o QR antigo">
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground break-all">
                O identificador interno da mesa não é exposto no QR; somente o token revogável é compartilhado.
              </p>
            </div>
          );
        })}
      </div>

      {!loading && tables.length === 0 && (
        <div className="kiosk-card p-6 text-center text-sm text-muted-foreground">Nenhuma mesa cadastrada.</div>
      )}
    </div>
  );
};

export default MesasPanel;
