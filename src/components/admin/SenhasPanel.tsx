import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Bell, ExternalLink, Trash2, Loader2, Tv, Crown } from 'lucide-react';

interface SenhaRow {
  id: string;
  numero: string;
  tipo: string;
  called_at: string;
}

interface Props {
  organizationId: string | null;
  orgSlug?: string | null;
}

const SENHA_PREFIX_KEY = 'senhas_prefix';
const SENHA_COUNTER_KEY = 'senhas_counter';

const SenhasPanel = ({ organizationId, orgSlug }: Props) => {
  const [prefix, setPrefix] = useState<string>(() => localStorage.getItem(SENHA_PREFIX_KEY) || 'A');
  const [counter, setCounter] = useState<number>(() => Number(localStorage.getItem(SENHA_COUNTER_KEY) || '0'));
  const [manualNumero, setManualNumero] = useState('');
  const [list, setList] = useState<SenhaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [callingNormal, setCallingNormal] = useState(false);
  const [callingPref, setCallingPref] = useState(false);

  useEffect(() => { localStorage.setItem(SENHA_PREFIX_KEY, prefix); }, [prefix]);
  useEffect(() => { localStorage.setItem(SENHA_COUNTER_KEY, String(counter)); }, [counter]);

  const load = async () => {
    if (!organizationId) { setList([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('senhas_chamadas')
      .select('id, numero, tipo, called_at')
      .eq('organization_id', organizationId)
      .order('called_at', { ascending: false })
      .limit(20);
    setList((data as SenhaRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    const ch = supabase
      .channel(`senhas-admin-${organizationId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'senhas_chamadas', filter: `organization_id=eq.${organizationId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [organizationId]);

  const chamar = async (tipo: 'normal' | 'preferencial', numeroForcado?: string) => {
    if (!organizationId) { toast.error('Selecione uma loja primeiro.'); return; }
    const setBusy = tipo === 'preferencial' ? setCallingPref : setCallingNormal;
    setBusy(true);
    try {
      let numero = (numeroForcado || '').trim();
      if (!numero) {
        const next = counter + 1;
        numero = `${prefix}${String(next).padStart(3, '0')}`;
        setCounter(next);
      }
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('senhas_chamadas').insert({
        organization_id: organizationId,
        numero,
        tipo,
        called_by: user?.id || null,
      });
      if (error) throw error;
      setManualNumero('');
      toast.success(`Senha ${numero} chamada!`);
    } catch (e: any) {
      toast.error(e.message || 'Erro ao chamar senha');
    } finally {
      setBusy(false);
    }
  };

  const limparHoje = async () => {
    if (!organizationId) return;
    if (!confirm('Apagar todas as senhas chamadas hoje?')) return;
    const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
    const { error } = await supabase
      .from('senhas_chamadas')
      .delete()
      .eq('organization_id', organizationId)
      .gte('called_at', inicioDia.toISOString());
    if (error) { toast.error(error.message); return; }
    setCounter(0);
    toast.success('Histórico do dia limpo.');
    load();
  };

  const resetContador = () => {
    if (!confirm('Zerar contador de senhas?')) return;
    setCounter(0);
    toast.success('Contador zerado.');
  };

  const tvUrl = orgSlug ? `${window.location.origin}/painel-senhas/${orgSlug}` : '';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex flex-wrap items-center gap-4 justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-500" /> Painel de Senhas
          </h2>
          <p className="text-zinc-400 text-sm mt-1">
            Chame senhas em tempo real e exiba na TV do estabelecimento.
          </p>
        </div>
        {tvUrl && (
          <a href={tvUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/40 hover:bg-amber-500/20 font-semibold text-sm">
            <Tv className="w-4 h-4" /> Abrir TV em nova aba <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Controles */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              Prefixo
            </label>
            <input
              value={prefix}
              onChange={e => setPrefix(e.target.value.toUpperCase().slice(0, 3))}
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-white font-mono text-lg focus:border-amber-500 outline-none"
              placeholder="A" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              Próx. número auto
            </label>
            <div className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-amber-400 font-mono text-lg">
              {prefix}{String(counter + 1).padStart(3, '0')}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              Ou número manual
            </label>
            <input
              value={manualNumero}
              onChange={e => setManualNumero(e.target.value.toUpperCase())}
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-white font-mono text-lg focus:border-amber-500 outline-none"
              placeholder="Ex: B042" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => chamar('normal', manualNumero || undefined)}
            disabled={callingNormal || !organizationId}
            className="px-6 py-5 rounded-2xl bg-gradient-to-b from-amber-500 to-orange-600 border border-amber-400 text-white font-black tracking-wider text-lg shadow-[0_0_25px_rgba(245,158,11,0.4)] hover:shadow-[0_0_35px_rgba(245,158,11,0.6)] active:scale-[0.98] transition disabled:opacity-50">
            {callingNormal ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'CHAMAR PRÓXIMA SENHA'}
          </button>
          <button
            onClick={() => chamar('preferencial', manualNumero || undefined)}
            disabled={callingPref || !organizationId}
            className="px-6 py-5 rounded-2xl bg-zinc-950 border border-amber-500/50 text-amber-400 font-black tracking-wider text-lg hover:bg-amber-500/10 active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center gap-2">
            {callingPref ? <Loader2 className="w-5 h-5 animate-spin" /> : (<><Crown className="w-5 h-5" /> SENHA PREFERENCIAL</>)}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <button onClick={resetContador}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
            Zerar contador
          </button>
          <button onClick={limparHoje}
            className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 flex items-center gap-1.5">
            <Trash2 className="w-3.5 h-3.5" /> Limpar histórico do dia
          </button>
        </div>
      </div>

      {/* Histórico */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-3">Últimas chamadas</h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
        ) : list.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-6">Nenhuma senha chamada ainda.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {list.map(s => (
              <div key={s.id} className="flex items-center justify-between px-4 py-3 rounded-lg bg-zinc-950 border border-zinc-800">
                <div className="flex items-center gap-3">
                  <span className="text-amber-400 font-black font-mono text-xl">{s.numero}</span>
                  {s.tipo === 'preferencial' && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded">
                      Pref.
                    </span>
                  )}
                </div>
                <span className="text-zinc-500 text-xs font-mono tabular-nums">
                  {new Date(s.called_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SenhasPanel;
