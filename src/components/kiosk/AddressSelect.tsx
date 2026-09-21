import { useState } from 'react';
import { ArrowLeft, MapPin, Search, Loader2, CheckCircle2, ShieldCheck, LocateFixed } from 'lucide-react';
import { fetchViaCep, maskCep, normalizeCep, reverseGeocodeCoords } from '@/lib/cep';
import { toast } from 'sonner';

export interface AddressSelectionDetails {
  cep: string;
  bairro: string;
  cidade: string;
  uf: string;
  source: 'cep' | 'gps';
  latitude?: number;
  longitude?: number;
}

interface Props {
  onConfirm: (address: string, reference: string, details?: AddressSelectionDetails) => void;
  onBack: () => void;
  allowCurrentLocation?: boolean;
}

const AddressSelect = ({ onConfirm, onBack, allowCurrentLocation = true }: Props) => {
  const [cep, setCep] = useState('');
  const [logradouro, setLogradouro] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [numero, setNumero] = useState('');
  const [complemento, setComplemento] = useState('');
  const [referencia, setReferencia] = useState('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [source, setSource] = useState<'cep' | 'gps'>('cep');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const buscar = async () => {
    const n = normalizeCep(cep);
    if (n.length !== 8) return toast.error('CEP inválido');

    setBusy(true);
    setResolved(false);
    setCoords(null);
    try {
      const via = await fetchViaCep(n);
      if (!via) return toast.error('CEP não encontrado');
      setLogradouro(via.logradouro || '');
      setBairro(via.bairro || '');
      setCidade(via.cidade || '');
      setUf(via.uf || '');
      setNumero('');
      setSource('cep');
      setResolved(true);
    } finally {
      setBusy(false);
    }
  };

  const usarLocalizacaoAtual = async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error('Este aparelho não oferece localização pelo navegador. Use o CEP.');
      return;
    }
    if (navigator.onLine === false) {
      toast.error('A localização do endereço precisa de internet. Use o CEP ou tente novamente quando a conexão voltar.');
      return;
    }

    setLocating(true);
    setResolved(false);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 60000,
        });
      });

      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const reverse = await reverseGeocodeCoords(lat, lng);
      if (!reverse) {
        toast.error('Encontramos sua posição, mas não foi possível identificar o endereço. Tente pelo CEP.');
        return;
      }

      setCep(reverse.cep ? maskCep(reverse.cep) : '');
      setLogradouro(reverse.logradouro || '');
      setBairro(reverse.bairro || '');
      setCidade(reverse.cidade || '');
      setUf(reverse.uf || '');
      setNumero(reverse.numero || '');
      setSource('gps');
      setCoords({ lat, lng });
      setResolved(true);

      const accuracy = Math.round(Number(position.coords.accuracy || 0));
      toast.success('Localização encontrada. Confira o endereço e o número antes de continuar.', {
        description: accuracy > 0 ? `Precisão aproximada do GPS: ${accuracy} m.` : undefined,
      });
    } catch (error: any) {
      const code = Number(error?.code || 0);
      const message = code === 1
        ? 'Permissão de localização negada. Você pode continuar normalmente pelo CEP.'
        : code === 3
          ? 'A localização demorou demais. Tente novamente ou use o CEP.'
          : 'Não foi possível obter sua localização agora. Tente novamente ou use o CEP.';
      toast.error(message);
    } finally {
      setLocating(false);
    }
  };

  const podeConfirmar = resolved && logradouro.trim().length > 2 && numero.trim().length > 0;

  const confirmar = () => {
    const endereco = `${logradouro}, ${numero}${complemento ? ' - ' + complemento : ''} - ${bairro}, ${cidade}/${uf}`;
    onConfirm(endereco.trim(), referencia.trim(), {
      cep: maskCep(cep),
      bairro: bairro.trim(),
      cidade: cidade.trim(),
      uf: uf.trim(),
      source,
      latitude: coords?.lat,
      longitude: coords?.lng,
    });
  };

  return (
    <div className="min-h-screen w-full bg-[#0B0B0D] font-[Inter] flex flex-col">
      <header className="flex items-center gap-3 px-5 pt-5">
        <button onClick={onBack} aria-label="Voltar"
          className="w-11 h-11 rounded-2xl bg-[#18181B] border border-zinc-800 flex items-center justify-center text-white hover:border-orange-500/50 transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500">
            <MapPin className="w-[18px] h-[18px]" />
          </div>
          <div>
            <div className="text-[11px] text-zinc-500 leading-none">Delivery</div>
            <div className="text-sm font-semibold text-white">Endereço de entrega</div>
          </div>
        </div>
      </header>

      <div className="px-6 mt-6">
        <h1 className="text-white font-extrabold text-[28px] sm:text-4xl leading-tight">
          Para onde<br />
          <span className="text-orange-500">vamos entregar?</span>
        </h1>
        <p className="text-zinc-400 text-sm mt-2">Confirme o endereço para liberar o cardápio.</p>
      </div>

      <div className="flex-1 px-5 mt-6 max-w-xl w-full mx-auto space-y-3">
        {allowCurrentLocation && (
          <>
            <button
              type="button"
              onClick={usarLocalizacaoAtual}
              disabled={locating || busy}
              className="w-full px-4 py-3.5 rounded-2xl border border-orange-500/40 bg-orange-500/10 text-orange-400 font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {locating ? <Loader2 className="w-5 h-5 animate-spin" /> : <LocateFixed className="w-5 h-5" />}
              {locating ? 'Localizando seu endereço...' : 'Usar minha localização atual'}
            </button>
            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-zinc-800" />
              <span className="text-[11px] uppercase tracking-wider text-zinc-600">ou use o CEP</span>
              <div className="h-px flex-1 bg-zinc-800" />
            </div>
          </>
        )}

        <div className="flex gap-2 min-w-0">
          <input
            value={cep}
            onChange={e => {
              setCep(maskCep(e.target.value));
              setResolved(false);
              setCoords(null);
            }}
            placeholder="00000-000"
            maxLength={9}
            inputMode="numeric"
            autoComplete="postal-code"
            className="flex-1 min-w-0 px-4 py-3 bg-[#18181B] border border-zinc-800 rounded-2xl text-white outline-none focus:border-orange-500/60"
          />
          <button onClick={buscar} disabled={busy || locating}
            className="shrink-0 px-4 py-3 rounded-2xl bg-orange-500 text-black font-bold flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Buscar
          </button>
        </div>

        {resolved && (
          <div className="space-y-3">
            <div className="px-4 py-3 bg-[#18181B] border border-zinc-800 rounded-2xl text-zinc-300 text-sm flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-white break-words">{logradouro || 'Endereço não identificado'}</p>
                <p className="text-xs text-zinc-500 mt-0.5 break-words">
                  {[bairro, cidade && uf ? `${cidade}/${uf}` : cidade || uf].filter(Boolean).join(', ')}
                  {cep ? ` · CEP ${cep}` : ''}
                </p>
                {source === 'gps' && (
                  <p className="text-[11px] text-orange-400 mt-1">Localização aproximada pelo aparelho — confirme o número.</p>
                )}
              </div>
            </div>
            <input
              value={logradouro}
              onChange={e => setLogradouro(e.target.value)}
              placeholder="Rua / avenida *"
              autoComplete="address-line1"
              className="w-full px-4 py-3 bg-[#18181B] border border-zinc-800 rounded-2xl text-white outline-none focus:border-orange-500/60"
            />
            <div className="grid grid-cols-2 gap-2">
              <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="Número"
                className="px-4 py-3 bg-[#18181B] border border-zinc-800 rounded-2xl text-white outline-none focus:border-orange-500/60" />
              <input value={complemento} onChange={e => setComplemento(e.target.value)} placeholder="Complemento"
                className="px-4 py-3 bg-[#18181B] border border-zinc-800 rounded-2xl text-white outline-none focus:border-orange-500/60" />
            </div>
            <input value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Ponto de referência (opcional)"
              className="w-full px-4 py-3 bg-[#18181B] border border-zinc-800 rounded-2xl text-white outline-none focus:border-orange-500/60" />
          </div>
        )}

        <button onClick={confirmar} disabled={!podeConfirmar}
          className="w-full mt-4 py-4 rounded-2xl font-bold text-black bg-gradient-to-r from-[#FF7A00] to-[#FFA726] disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_10px_30px_-10px_rgba(255,122,0,0.55)] active:scale-[0.99] transition">
          Confirmar endereço e ver cardápio
        </button>
      </div>

      <footer className="px-6 py-7 flex items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#18181B] border border-zinc-800 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-orange-500" />
        </div>
        <p className="text-zinc-500 text-xs max-w-[260px]">Seus dados de entrega são usados apenas para concluir o pedido.</p>
      </footer>
    </div>
  );
};

export default AddressSelect;
