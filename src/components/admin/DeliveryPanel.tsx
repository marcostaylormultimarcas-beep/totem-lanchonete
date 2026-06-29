import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Save, Truck, Clock, DollarSign, Radius } from 'lucide-react';

interface Props { organizationId: string | null; }

const DeliveryPanel = ({ organizationId }: Props) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [taxaBase, setTaxaBase] = useState(5);
  const [raioKm, setRaioKm] = useState(5);
  const [pedidoMin, setPedidoMin] = useState(0);
  const [tempoBase, setTempoBase] = useState(30);
  const [horaIni, setHoraIni] = useState('');
  const [horaFim, setHoraFim] = useState('');

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('settings')
        .select('delivery_enabled, delivery_taxa_base, delivery_raio_km, delivery_tempo_base_min, delivery_pedido_minimo, delivery_horario_inicio, delivery_horario_fim')
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (data) {
        const d: any = data;
        setEnabled(d.delivery_enabled !== false);
        setTaxaBase(Number(d.delivery_taxa_base ?? 5));
        setRaioKm(Number(d.delivery_raio_km ?? 5));
        setTempoBase(Number(d.delivery_tempo_base_min ?? 30));
        setPedidoMin(Number(d.delivery_pedido_minimo ?? 0));
        setHoraIni(d.delivery_horario_inicio || '');
        setHoraFim(d.delivery_horario_fim || '');
      }
      setLoading(false);
    })();
  }, [organizationId]);

  const salvar = async () => {
    if (!organizationId) return;
    setSaving(true);
    const { error } = await supabase
      .from('settings')
      .update({
        delivery_enabled: enabled,
        delivery_taxa_base: taxaBase,
        delivery_raio_km: raioKm,
        delivery_tempo_base_min: Math.round(tempoBase),
        delivery_pedido_minimo: pedidoMin,
        delivery_horario_inicio: horaIni || null,
        delivery_horario_fim: horaFim || null,
      } as any)
      .eq('organization_id', organizationId);
    setSaving(false);
    if (error) return toast.error('Erro: ' + error.message);
    toast.success('Delivery atualizado!');
  };

  if (loading) {
    return <div className="px-4 py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="px-4 space-y-5 max-w-3xl pb-10">
      <div className="kiosk-card p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <Truck className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="font-black text-lg">Modalidade Delivery</h2>
          <p className="text-xs text-muted-foreground">Ative para permitir entregas via aplicativo.</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input type="checkbox" className="sr-only peer" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <div className="w-11 h-6 bg-muted peer-checked:bg-primary rounded-full relative transition">
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition ${enabled ? 'translate-x-5' : ''}`} />
          </div>
        </label>
      </div>

      <div className="kiosk-card p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs">
          <span className="flex items-center gap-1 mb-1"><DollarSign className="w-3.5 h-3.5 text-primary" /> Taxa de entrega (R$)</span>
          <input type="number" min={0} step={0.5} value={taxaBase} onChange={e => setTaxaBase(Number(e.target.value))}
            className="w-full px-3 py-2 bg-muted rounded-lg outline-none" />
        </label>
        <label className="text-xs">
          <span className="flex items-center gap-1 mb-1"><Radius className="w-3.5 h-3.5 text-primary" /> Raio de entrega (km)</span>
          <input type="number" min={0} step={0.5} value={raioKm} onChange={e => setRaioKm(Number(e.target.value))}
            className="w-full px-3 py-2 bg-muted rounded-lg outline-none" />
        </label>
        <label className="text-xs">
          <span className="flex items-center gap-1 mb-1"><DollarSign className="w-3.5 h-3.5 text-primary" /> Pedido mínimo (R$)</span>
          <input type="number" min={0} step={0.5} value={pedidoMin} onChange={e => setPedidoMin(Number(e.target.value))}
            className="w-full px-3 py-2 bg-muted rounded-lg outline-none" />
        </label>
        <label className="text-xs">
          <span className="flex items-center gap-1 mb-1"><Clock className="w-3.5 h-3.5 text-primary" /> Tempo estimado (min)</span>
          <input type="number" min={0} value={tempoBase} onChange={e => setTempoBase(Number(e.target.value))}
            className="w-full px-3 py-2 bg-muted rounded-lg outline-none" />
        </label>
        <label className="text-xs">
          <span className="flex items-center gap-1 mb-1"><Clock className="w-3.5 h-3.5 text-primary" /> Início do funcionamento</span>
          <input type="time" value={horaIni} onChange={e => setHoraIni(e.target.value)}
            className="w-full px-3 py-2 bg-muted rounded-lg outline-none" />
        </label>
        <label className="text-xs">
          <span className="flex items-center gap-1 mb-1"><Clock className="w-3.5 h-3.5 text-primary" /> Fim do funcionamento</span>
          <input type="time" value={horaFim} onChange={e => setHoraFim(e.target.value)}
            className="w-full px-3 py-2 bg-muted rounded-lg outline-none" />
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Ajustes finos por bairro ou raio detalhado podem ser feitos em <strong>Bairros</strong> e <strong>Área CEP</strong>.
      </p>

      <button onClick={salvar} disabled={saving}
        className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold flex items-center justify-center gap-2">
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} Salvar Delivery
      </button>
    </div>
  );
};

export default DeliveryPanel;
