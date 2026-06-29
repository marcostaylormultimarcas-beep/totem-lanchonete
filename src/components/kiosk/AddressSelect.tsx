import { useState } from 'react';
import { ArrowLeft, MapPin, Search, Loader2, CheckCircle2, ShieldCheck } from 'lucide-react';
import { fetchViaCep, maskCep, normalizeCep } from '@/lib/cep';
import { toast } from 'sonner';

interface Props {
  onConfirm: (address: string, reference: string) => void;
  onBack: () => void;
}

const AddressSelect = ({ onConfirm, onBack }: Props) => {
  const [cep, setCep] = useState('');
  const [logradouro, setLogradouro] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [numero, setNumero] = useState('');
  const [complemento, setComplemento] = useState('');
  const [referencia, setReferencia] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState(false);

  const buscar = async () => {
    const n = normalizeCep(cep);
    if (n.length !== 8) return toast.error('CEP inválido');
    setBusy(true);
    const via = await fetchViaCep(n);
    setBusy(false);
    if (!via) return toast.error('CEP não encontrado');
    setLogradouro(via.logradouro || '');
    setBairro(via.bairro || '');
    setCidade(via.cidade || '');
    setUf(via.uf || '');
    setResolved(true);
  };

  const podeConfirmar = resolved && numero.trim().length > 0;

  const confirmar = () => {
    const endereco = `${logradouro}, ${numero}${complemento ? ' - ' + complemento : ''} - ${bairro}, ${cidade}/${uf}`;
    onConfirm(endereco.trim(), referencia.trim());
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
        <div className="flex gap-2">
          <input value={cep} onChange={e => setCep(maskCep(e.target.value))} placeholder="00000-000" maxLength={9}
            className="flex-1 px-4 py-3 bg-[#18181B] border border-zinc-800 rounded-2xl text-white outline-none focus:border-orange-500/60" />
          <button onClick={buscar} disabled={busy}
            className="px-4 py-3 rounded-2xl bg-orange-500 text-black font-bold flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Buscar
          </button>
        </div>

        {resolved && (
          <div className="space-y-3">
            <div className="px-4 py-3 bg-[#18181B] border border-zinc-800 rounded-2xl text-zinc-300 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              {logradouro || '—'}, {bairro}, {cidade}/{uf}
            </div>
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
