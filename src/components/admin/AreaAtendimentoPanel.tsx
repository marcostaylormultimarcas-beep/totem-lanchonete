import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Save, MapPin, Plus, Trash2, Search, Radius, List, Building } from 'lucide-react';
import { fetchViaCep, geocodeAddress, maskCep, normalizeCep } from '@/lib/cep';

type DeliveryMode = 'bairros' | 'raio_km' | 'lista_ceps';

interface CepRow {
  id: string;
  cep: string;
  taxa: number;
  tempo_min: number;
}

const AreaAtendimentoPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<DeliveryMode>('bairros');
  const [cepLoja, setCepLoja] = useState('');
  const [endereco, setEndereco] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [raioKm, setRaioKm] = useState(5);
  const [taxaBase, setTaxaBase] = useState(5);
  const [taxaPorKm, setTaxaPorKm] = useState(1.5);
  const [tempoBase, setTempoBase] = useState(20);
  const [tempoPorKm, setTempoPorKm] = useState(3);
  const [buscandoCep, setBuscandoCep] = useState(false);

  // Lista de CEPs
  const [ceps, setCeps] = useState<CepRow[]>([]);
  const [novoCep, setNovoCep] = useState('');
  const [novaTaxa, setNovaTaxa] = useState(0);
  const [novoTempo, setNovoTempo] = useState(30);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      setLoading(true);
      const [{ data: s }, { data: cs }] = await Promise.all([
        supabase.from('settings').select('cep_loja, cep_lat, cep_lng, delivery_mode, delivery_raio_km, delivery_taxa_base, delivery_taxa_por_km, delivery_tempo_base_min, delivery_tempo_por_km_min').eq('organization_id', organizationId).maybeSingle(),
        supabase.from('cep_atendidos' as any).select('id, cep, taxa, tempo_min').eq('organization_id', organizationId).order('cep'),
      ]);
      if (s) {
        setCepLoja(maskCep((s as any).cep_loja || ''));
        setLat((s as any).cep_lat ?? null);
        setLng((s as any).cep_lng ?? null);
        setMode(((s as any).delivery_mode || 'bairros') as DeliveryMode);
        setRaioKm(Number((s as any).delivery_raio_km ?? 5));
        setTaxaBase(Number((s as any).delivery_taxa_base ?? 5));
        setTaxaPorKm(Number((s as any).delivery_taxa_por_km ?? 1.5));
        setTempoBase(Number((s as any).delivery_tempo_base_min ?? 20));
        setTempoPorKm(Number((s as any).delivery_tempo_por_km_min ?? 3));
      }
      setCeps(((cs as any[]) || []).map(c => ({ id: c.id, cep: c.cep, taxa: Number(c.taxa), tempo_min: c.tempo_min })));
      setLoading(false);
    })();
  }, [organizationId]);

  const buscarCepLoja = async () => {
    const n = normalizeCep(cepLoja);
    if (n.length !== 8) return toast.error('CEP inválido');
    setBuscandoCep(true);
    const via = await fetchViaCep(n);
    if (!via) { setBuscandoCep(false); return toast.error('CEP não encontrado'); }
    const enderecoStr = `${via.logradouro}, ${via.bairro}, ${via.cidade} - ${via.uf}`;
    setEndereco(enderecoStr);
    const coords = await geocodeAddress(`${enderecoStr}, Brasil`);
    if (coords) {
      setLat(coords.lat); setLng(coords.lng);
      console.log('[CEP] Loja geocodificada:', coords);
      toast.success('Endereço e coordenadas resolvidos');
    } else {
      toast.warning('Endereço resolvido, mas não foi possível obter coordenadas (tente novamente em alguns segundos)');
    }
    setBuscandoCep(false);
  };

  const salvar = async () => {
    if (!organizationId) return;
    setSaving(true);
    const { error } = await supabase.from('settings').update({
      cep_loja: normalizeCep(cepLoja),
      cep_lat: lat, cep_lng: lng,
      delivery_mode: mode,
      delivery_raio_km: raioKm,
      delivery_taxa_base: taxaBase,
      delivery_taxa_por_km: taxaPorKm,
      delivery_tempo_base_min: Math.round(tempoBase),
      delivery_tempo_por_km_min: tempoPorKm,
    }).eq('organization_id', organizationId);
    setSaving(false);
    if (error) return toast.error('Erro: ' + error.message);
    toast.success('Área de atendimento atualizada!');
  };

  const addCep = async () => {
    if (!organizationId) return;
    const n = normalizeCep(novoCep);
    if (n.length !== 8) return toast.error('CEP inválido');
    const { data, error } = await supabase.from('cep_atendidos' as any).insert({
      organization_id: organizationId, cep: n, taxa: novaTaxa, tempo_min: novoTempo,
    }).select('id, cep, taxa, tempo_min').single();
    if (error) return toast.error(error.message);
    setCeps([...ceps, { id: (data as any).id, cep: (data as any).cep, taxa: Number((data as any).taxa), tempo_min: (data as any).tempo_min }].sort((a, b) => a.cep.localeCompare(b.cep)));
    setNovoCep(''); setNovaTaxa(0); setNovoTempo(30);
  };

  const removeCep = async (id: string) => {
    const { error } = await supabase.from('cep_atendidos' as any).delete().eq('id', id);
    if (error) return toast.error(error.message);
    setCeps(ceps.filter(c => c.id !== id));
  };

  if (loading) return <div className="px-4 py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;

  return (
    <div className="px-4 space-y-5 max-w-3xl pb-10">
      {/* CEP da loja */}
      <div className="kiosk-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center"><MapPin className="w-5 h-5 text-primary" /></div>
          <div>
            <h2 className="font-black text-lg">CEP central da Loja</h2>
            <p className="text-xs text-muted-foreground">Usado como referência para calcular distâncias.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input value={cepLoja} onChange={e => setCepLoja(maskCep(e.target.value))} placeholder="00000-000" maxLength={9}
            className="flex-1 px-3 py-2 bg-muted rounded-lg outline-none" />
          <button onClick={buscarCepLoja} disabled={buscandoCep}
            className="touch-btn px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold flex items-center gap-2 disabled:opacity-50">
            {buscandoCep ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Buscar
          </button>
        </div>
        {endereco && <p className="text-xs text-muted-foreground">📍 {endereco}</p>}
        {lat != null && lng != null && (
          <p className="text-xs text-success">✓ Coordenadas: {lat.toFixed(5)}, {lng.toFixed(5)}</p>
        )}
      </div>

      {/* Modo */}
      <div className="kiosk-card p-4 space-y-3">
        <h2 className="font-black text-lg">Modo de Atendimento</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {[
            { v: 'bairros' as const, l: 'Por bairros', icon: Building },
            { v: 'raio_km' as const, l: 'Por raio (km)', icon: Radius },
            { v: 'lista_ceps' as const, l: 'Por lista de CEPs', icon: List },
          ].map(opt => (
            <button key={opt.v} onClick={() => setMode(opt.v)}
              className={`p-3 rounded-xl border-2 flex items-center gap-2 font-bold text-sm ${mode === opt.v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
              <opt.icon className="w-4 h-4" /> {opt.l}
            </button>
          ))}
        </div>

        {mode === 'raio_km' && (
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">Frete = Taxa base + (Taxa por km × distância). Tempo = Tempo base + (Tempo por km × distância).</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">Raio máximo (km)
                <input type="number" min={1} step={0.5} value={raioKm} onChange={e => setRaioKm(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-muted rounded-lg outline-none" />
              </label>
              <label className="text-xs">Tempo base (min)
                <input type="number" min={0} value={tempoBase} onChange={e => setTempoBase(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-muted rounded-lg outline-none" />
              </label>
              <label className="text-xs">Taxa base (R$)
                <input type="number" min={0} step={0.5} value={taxaBase} onChange={e => setTaxaBase(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-muted rounded-lg outline-none" />
              </label>
              <label className="text-xs">Taxa por km (R$)
                <input type="number" min={0} step={0.1} value={taxaPorKm} onChange={e => setTaxaPorKm(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-muted rounded-lg outline-none" />
              </label>
              <label className="text-xs col-span-2">Tempo por km (min)
                <input type="number" min={0} step={0.5} value={tempoPorKm} onChange={e => setTempoPorKm(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-muted rounded-lg outline-none" />
              </label>
            </div>
            {(lat == null || lng == null) && (
              <p className="text-xs text-destructive">⚠️ Defina o CEP da loja acima e clique em "Buscar" para que o modo "raio" funcione.</p>
            )}
          </div>
        )}

        {mode === 'bairros' && (
          <p className="text-xs text-muted-foreground">A loja atende apenas os bairros cadastrados na aba "Bairros". O cliente escolhe o bairro no checkout.</p>
        )}
      </div>

      <button onClick={salvar} disabled={saving}
        className="touch-btn w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold flex items-center justify-center gap-2">
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} Salvar Área de Atendimento
      </button>

      {/* Lista de CEPs */}
      {mode === 'lista_ceps' && (
        <div className="kiosk-card p-4 space-y-3">
          <h2 className="font-black text-lg">CEPs atendidos</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <input value={novoCep} onChange={e => setNovoCep(maskCep(e.target.value))} placeholder="CEP" maxLength={9}
              className="px-3 py-2 bg-muted rounded-lg outline-none" />
            <input type="number" min={0} step={0.5} value={novaTaxa} onChange={e => setNovaTaxa(Number(e.target.value))} placeholder="Taxa R$"
              className="px-3 py-2 bg-muted rounded-lg outline-none" />
            <input type="number" min={0} value={novoTempo} onChange={e => setNovoTempo(Number(e.target.value))} placeholder="Tempo (min)"
              className="px-3 py-2 bg-muted rounded-lg outline-none" />
            <button onClick={addCep}
              className="touch-btn px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" /> Adicionar
            </button>
          </div>

          <div className="space-y-1 max-h-80 overflow-auto">
            {ceps.length === 0 && <p className="text-xs text-muted-foreground">Nenhum CEP cadastrado ainda.</p>}
            {ceps.map(c => (
              <div key={c.id} className="flex items-center justify-between p-2 bg-muted/40 rounded-lg">
                <div className="text-sm font-mono">{maskCep(c.cep)}</div>
                <div className="text-xs text-muted-foreground">R$ {c.taxa.toFixed(2)} · {c.tempo_min} min</div>
                <button onClick={() => removeCep(c.id)} className="text-destructive p-1 hover:bg-destructive/10 rounded">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AreaAtendimentoPanel;
