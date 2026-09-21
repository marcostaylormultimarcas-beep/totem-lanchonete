import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Save, MapPin, Plus, Trash2, Search, Radius, List, Building, LocateFixed } from 'lucide-react';
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
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [stateUf, setStateUf] = useState('');
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
        supabase.from('settings').select('cep_loja, cep_lat, cep_lng, delivery_origin_cep, delivery_origin_street, delivery_origin_number, delivery_origin_complement, delivery_origin_neighborhood, delivery_origin_city, delivery_origin_state, delivery_origin_lat, delivery_origin_lng, delivery_mode, delivery_raio_km, delivery_taxa_base, delivery_taxa_por_km, delivery_tempo_base_min, delivery_tempo_por_km_min').eq('organization_id', organizationId).maybeSingle(),
        supabase.from('cep_atendidos' as any).select('id, cep, taxa, tempo_min').eq('organization_id', organizationId).order('cep'),
      ]);
      if (s) {
        const originCep = (s as any).delivery_origin_cep || (s as any).cep_loja || '';
        const originStreet = (s as any).delivery_origin_street || '';
        const originNumber = (s as any).delivery_origin_number || '';
        const originComplement = (s as any).delivery_origin_complement || '';
        const originNeighborhood = (s as any).delivery_origin_neighborhood || '';
        const originCity = (s as any).delivery_origin_city || '';
        const originState = (s as any).delivery_origin_state || '';

        setCepLoja(maskCep(originCep));
        setStreet(originStreet);
        setNumber(originNumber);
        setComplement(originComplement);
        setNeighborhood(originNeighborhood);
        setCity(originCity);
        setStateUf(originState);
        setEndereco([
          [originStreet, originNumber].filter(Boolean).join(', '),
          originNeighborhood,
          [originCity, originState].filter(Boolean).join(' - '),
        ].filter(Boolean).join(' · '));
        setLat((s as any).delivery_origin_lat ?? (s as any).cep_lat ?? null);
        setLng((s as any).delivery_origin_lng ?? (s as any).cep_lng ?? null);
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

  const invalidateOriginCoords = () => {
    setLat(null);
    setLng(null);
  };

  const buildOriginAddress = () => [
    [street.trim(), number.trim()].filter(Boolean).join(', '),
    complement.trim(),
    neighborhood.trim(),
    [city.trim(), stateUf.trim().toUpperCase()].filter(Boolean).join(' - '),
    normalizeCep(cepLoja) ? `CEP ${maskCep(cepLoja)}` : '',
    'Brasil',
  ].filter(Boolean).join(', ');

  const buscarCepLoja = async () => {
    const n = normalizeCep(cepLoja);
    if (n.length !== 8) return toast.error('CEP inválido');
    setBuscandoCep(true);
    const via = await fetchViaCep(n);
    if (!via) {
      setBuscandoCep(false);
      return toast.error('CEP não encontrado');
    }

    setCepLoja(maskCep(n));
    setStreet(via.logradouro || '');
    setNeighborhood(via.bairro || '');
    setCity(via.cidade || '');
    setStateUf(via.uf || '');
    setEndereco([
      via.logradouro,
      via.bairro,
      [via.cidade, via.uf].filter(Boolean).join(' - '),
    ].filter(Boolean).join(' · '));
    invalidateOriginCoords();
    setBuscandoCep(false);
    toast.success('CEP encontrado. Informe o número e confirme a localização.');
  };

  const confirmarLocalizacao = async () => {
    const n = normalizeCep(cepLoja);
    if (n.length !== 8) return toast.error('Informe um CEP válido.');
    if (!street.trim()) return toast.error('Confira o campo Rua / Avenida.');
    if (!number.trim()) return toast.error('Preencha o campo Número ou informe S/N.');
    if (!city.trim() || stateUf.trim().length !== 2) return toast.error('Confira os campos Cidade e UF.');

    setBuscandoCep(true);

    const normalizedNumber = number.trim().toLowerCase().replace(/\s+/g, '');
    const withoutExactNumber = ['0', 's/n', 'sn', 'semnumero', 'semnúmero'].includes(normalizedNumber);
    const fullAddress = buildOriginAddress();
    const streetAddress = [
      street.trim(),
      neighborhood.trim(),
      [city.trim(), stateUf.trim().toUpperCase()].filter(Boolean).join(' - '),
      `CEP ${maskCep(cepLoja)}`,
      'Brasil',
    ].filter(Boolean).join(', ');

    let coords = withoutExactNumber ? null : await geocodeAddress(fullAddress);
    let usedStreetFallback = withoutExactNumber;

    if (!coords) {
      coords = await geocodeAddress(streetAddress);
      usedStreetFallback = Boolean(coords);
    }

    if (!coords) {
      setBuscandoCep(false);
      return toast.error('Os campos estão preenchidos, mas o mapa não encontrou esse endereço. Confira principalmente Rua / Avenida, Número, Cidade e CEP.');
    }

    setLat(coords.lat);
    setLng(coords.lng);
    setEndereco(fullAddress.replace(', Brasil', ''));
    setBuscandoCep(false);

    if (usedStreetFallback) {
      toast.warning('Localização confirmada pelo logradouro/CEP. Como o número não foi localizado, a origem pode ficar aproximada.');
    } else {
      toast.success('Localização exata da loja confirmada.');
    }
  };

  const salvar = async () => {
    if (!organizationId) return;

    const originTouched = Boolean(
      normalizeCep(cepLoja) || street.trim() || number.trim() || neighborhood.trim() || city.trim() || stateUf.trim()
    );

    if (originTouched) {
      if (normalizeCep(cepLoja).length !== 8) return toast.error('Confira o CEP da loja.');
      if (!street.trim()) return toast.error('Informe a rua da loja.');
      if (!number.trim()) return toast.error('Informe o número da loja.');
      if (!neighborhood.trim()) return toast.error('Informe o bairro da loja.');
      if (!city.trim() || stateUf.trim().length !== 2) return toast.error('Confira cidade e UF.');
      if (lat == null || lng == null) {
        return toast.error('Confirme a localização da loja antes de salvar.');
      }
    }

    if (mode === 'raio_km') {
      toast.error('O modo por raio continua bloqueado até a validação autoritativa do destino no servidor.');
      return;
    }

    setSaving(true);
    const payload: any = {
      cep_loja: normalizeCep(cepLoja),
      cep_lat: lat,
      cep_lng: lng,
      delivery_origin_cep: normalizeCep(cepLoja),
      delivery_origin_street: street.trim(),
      delivery_origin_number: number.trim(),
      delivery_origin_complement: complement.trim(),
      delivery_origin_neighborhood: neighborhood.trim(),
      delivery_origin_city: city.trim(),
      delivery_origin_state: stateUf.trim().toUpperCase(),
      delivery_origin_lat: lat,
      delivery_origin_lng: lng,
      delivery_origin_confirmed_at: lat != null && lng != null ? new Date().toISOString() : null,
      delivery_mode: mode,
      delivery_raio_km: raioKm,
      delivery_taxa_base: taxaBase,
      delivery_taxa_por_km: taxaPorKm,
      delivery_tempo_base_min: Math.round(tempoBase),
      delivery_tempo_por_km_min: tempoPorKm,
    };

    const { error } = await supabase
      .from('settings')
      .update(payload)
      .eq('organization_id', organizationId);

    setSaving(false);
    if (error) return toast.error('Erro: ' + error.message);
    toast.success('Endereço de origem e área de atendimento atualizados!');
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
      {/* Origem do delivery */}
      <div className="kiosk-card p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <MapPin className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="font-black text-lg">Endereço de saída da Loja</h2>
            <p className="text-xs text-muted-foreground">
              Esta é a origem oficial usada pelo delivery, roteirização e cálculos de distância.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
          <label className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground">CEP</span>
            <input
              value={cepLoja}
              onChange={e => {
                setCepLoja(maskCep(e.target.value));
                invalidateOriginCoords();
              }}
              placeholder="00000-000"
              maxLength={9}
              className="w-full px-3 py-2 bg-muted rounded-lg outline-none"
            />
          </label>
          <button
            type="button"
            onClick={buscarCepLoja}
            disabled={buscandoCep}
            className="touch-btn px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {buscandoCep ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Buscar CEP
          </button>
        </div>

        <div className="grid sm:grid-cols-[2fr_0.7fr] gap-2">
          <label className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground">Rua / Avenida</span>
            <input
              value={street}
              onChange={e => { setStreet(e.target.value); invalidateOriginCoords(); }}
              placeholder="Rua / Avenida"
              maxLength={160}
              className="w-full px-3 py-2 bg-muted rounded-lg outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground">Número</span>
            <input
              value={number}
              onChange={e => { setNumber(e.target.value); invalidateOriginCoords(); }}
              placeholder="Ex.: 123 ou S/N"
              maxLength={20}
              className="w-full px-3 py-2 bg-muted rounded-lg outline-none"
            />
          </label>
        </div>

        <label className="space-y-1 block">
          <span className="text-xs font-bold text-muted-foreground">Complemento <span className="font-normal">(opcional)</span></span>
          <input
            value={complement}
            onChange={e => { setComplement(e.target.value); invalidateOriginCoords(); }}
            placeholder="Sala, bloco, referência..."
            maxLength={100}
            className="w-full px-3 py-2 bg-muted rounded-lg outline-none"
          />
        </label>

        <div className="grid sm:grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground">Bairro</span>
            <input
              value={neighborhood}
              onChange={e => { setNeighborhood(e.target.value); invalidateOriginCoords(); }}
              placeholder="Bairro"
              maxLength={100}
              className="w-full px-3 py-2 bg-muted rounded-lg outline-none"
            />
          </label>
          <div className="grid grid-cols-[1fr_74px] gap-2">
            <label className="space-y-1">
              <span className="text-xs font-bold text-muted-foreground">Cidade</span>
              <input
                value={city}
                onChange={e => { setCity(e.target.value); invalidateOriginCoords(); }}
                placeholder="Cidade"
                maxLength={100}
                className="w-full px-3 py-2 bg-muted rounded-lg outline-none"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold text-muted-foreground">UF</span>
              <input
                value={stateUf}
                onChange={e => { setStateUf(e.target.value.toUpperCase().slice(0, 2)); invalidateOriginCoords(); }}
                placeholder="UF"
                maxLength={2}
                className="w-full px-3 py-2 bg-muted rounded-lg outline-none uppercase"
              />
            </label>
          </div>
        </div>

        <button
          type="button"
          onClick={confirmarLocalizacao}
          disabled={buscandoCep}
          className="touch-btn w-full px-4 py-3 rounded-xl border border-primary/30 bg-primary/10 text-primary font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {buscandoCep ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
          Confirmar localização da loja
        </button>

        {endereco && (
          <p className="text-xs text-muted-foreground">📍 {endereco}</p>
        )}
        {lat != null && lng != null ? (
          <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2">
            <p className="text-xs text-success font-bold">✓ Origem confirmada</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Coordenadas: {lat.toFixed(5)}, {lng.toFixed(5)}
            </p>
          </div>
        ) : (
          <p className="text-xs text-amber-400">
            Confira os campos acima. Se a loja não tiver número, informe S/N; nesse caso a localização será confirmada pelo logradouro/CEP.
          </p>
        )}
      </div>

      {/* Modo */}
      <div className="kiosk-card p-4 space-y-3">
        <h2 className="font-black text-lg">Modo de Atendimento</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {[
            { v: 'bairros' as const, l: 'Por bairros', icon: Building, disabled: false },
            { v: 'raio_km' as const, l: 'Por raio (km)', icon: Radius, disabled: true },
            { v: 'lista_ceps' as const, l: 'Por lista de CEPs', icon: List, disabled: false },
          ].map(opt => (
            <button key={opt.v} disabled={opt.disabled} onClick={() => !opt.disabled && setMode(opt.v)}
              title={opt.disabled ? 'A origem exata já pode ser cadastrada. O modo por raio segue bloqueado até o destino também ser validado de forma autoritativa no servidor.' : undefined}
              className={`p-3 rounded-xl border-2 flex items-center gap-2 font-bold text-sm ${mode === opt.v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'} ${opt.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <opt.icon className="w-4 h-4" /> {opt.l}{opt.disabled ? ' — indisponível' : ''}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          A origem exata da loja agora fica salva. O modo por raio continua bloqueado até o destino do cliente ser validado no servidor, evitando fraude no frete. Bairros e lista de CEPs continuam funcionando normalmente.
        </p>

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
              <p className="text-xs text-destructive">⚠️ Cadastre e confirme o endereço completo da loja acima.</p>
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
