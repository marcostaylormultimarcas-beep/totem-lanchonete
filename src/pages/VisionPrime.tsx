import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Crown, Check, Sparkles, Loader2, ArrowLeft, ShieldCheck, Truck, Percent } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrgId } from '@/contexts/OrgContext';
import { useVisionPrimeConfig, useVisionPrimeStatus } from '@/hooks/useVisionPrime';
import { formatCurrency } from '@/data/store';
import { toast } from 'sonner';

const VisionPrime = () => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const orgId = useOrgId();
  const { config, loading } = useVisionPrimeConfig(orgId);
  const { status, refresh } = useVisionPrimeStatus(orgId);
  const [authed, setAuthed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(Boolean(data.session)));
  }, []);

  const back = () => navigate(slug ? `/loja/${slug}` : '/');

  const subscribe = async () => {
    if (!authed) {
      toast.info('Faça login para assinar o Vision Prime.');
      navigate(`/auth?returnTo=${encodeURIComponent(slug ? `/loja/${slug}/prime` : '/')}`);
      return;
    }
    if (!orgId) return;
    setSubscribing(true);
    const { data, error } = await supabase.rpc('vision_prime_subscribe' as any, { _org: orgId });
    setSubscribing(false);
    if (error || (data as any)?.ok === false) {
      toast.error((data as any)?.reason || error?.message || 'Erro ao assinar');
      return;
    }
    toast.success('Bem-vindo ao Vision Prime!');
    refresh();
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }
  if (!config?.ativo) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <Crown className="w-10 h-10 text-muted-foreground" />
        <p className="text-muted-foreground">O clube Vision Prime não está disponível nesta loja no momento.</p>
        <button onClick={back} className="touch-btn bg-primary text-primary-foreground px-6 py-3 rounded-xl">Voltar</button>
      </div>
    );
  }

  const gold = 'linear-gradient(135deg,#f6c560 0%,#d4881e 50%,#7a4a07 100%)';

  return (
    <div className="min-h-screen text-white" style={{ background: 'radial-gradient(circle at top, #1a1208 0%, #0a0604 60%, #000 100%)' }}>
      <div className="max-w-[900px] mx-auto px-5 py-6">
        <button onClick={back} className="flex items-center gap-2 text-amber-100/70 hover:text-amber-100 mb-6">
          <ArrowLeft className="w-5 h-5" /> Voltar
        </button>

        <div className="text-center space-y-3 mb-8">
          <div className="inline-flex w-20 h-20 rounded-2xl items-center justify-center mb-2" style={{ background: gold, boxShadow: '0 12px 40px -10px #d4881e' }}>
            <Crown className="w-10 h-10 text-black" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight" style={{ background: gold, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Vision Prime
          </h1>
          <p className="text-amber-100/80 max-w-xl mx-auto">
            O clube de assinatura premium da loja. Economize em todos os pedidos, ganhe frete grátis e curta benefícios exclusivos.
          </p>
        </div>

        {status.active ? (
          <div className="rounded-2xl border-2 p-6 text-center space-y-3" style={{ borderColor: '#d4a04c', background: '#1a1208' }}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold text-black" style={{ background: gold }}>
              <Crown className="w-4 h-4" /> Membro Prime desde {status.sinceYear ?? new Date().getFullYear()}
            </div>
            <p className="text-amber-100/80 text-sm">Você já está aproveitando todos os benefícios automáticos no checkout.</p>
          </div>
        ) : (
          <div className="rounded-2xl border-2 p-6 space-y-5" style={{ borderColor: 'rgba(212,160,76,0.4)', background: 'rgba(26,18,8,0.85)' }}>
            <div className="grid sm:grid-cols-3 gap-4">
              <Benefit icon={<Percent className="w-5 h-5" />} title={`${config.desconto_percentual}% de desconto`} desc="Aplicado automaticamente em todo pedido." />
              <Benefit icon={<Truck className="w-5 h-5" />} title="Frete grátis" desc={config.frete_gratis_minimo > 0 ? `Em compras acima de ${formatCurrency(config.frete_gratis_minimo)}.` : 'Em todos os seus pedidos.'} />
              <Benefit icon={<ShieldCheck className="w-5 h-5" />} title="Selo dourado" desc="Status premium visível no app." />
            </div>

            <div className="text-center pt-2">
              <p className="text-amber-100/70 text-sm">Por apenas</p>
              <p className="text-4xl font-black my-1" style={{ background: gold, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {formatCurrency(config.valor_mensalidade)}
                <span className="text-base font-bold text-amber-100/70">/mês</span>
              </p>
            </div>

            <button onClick={subscribe} disabled={subscribing}
              className="w-full py-4 rounded-xl font-black text-lg text-black flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: gold, boxShadow: '0 10px 30px -10px #d4881e' }}>
              {subscribing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
              {subscribing ? 'Ativando...' : 'Assinar Agora'}
            </button>
            <p className="text-[11px] text-amber-100/50 text-center">Cobrança simulada por 30 dias. Você pode cancelar a qualquer momento.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const Benefit = ({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) => (
  <div className="rounded-xl p-4 border border-[#d4a04c]/30 bg-black/40 space-y-1.5">
    <div className="w-9 h-9 rounded-lg flex items-center justify-center text-black" style={{ background: 'linear-gradient(135deg,#f6c560,#d4881e)' }}>{icon}</div>
    <p className="font-bold text-amber-100">{title}</p>
    <p className="text-xs text-amber-100/60 leading-snug">{desc}</p>
  </div>
);

export default VisionPrime;
