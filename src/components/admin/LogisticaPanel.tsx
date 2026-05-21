import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Truck, Users, Zap, KeyRound, Save, Loader2 } from 'lucide-react';

type Mode = 'manual' | 'free';

const LogisticaPanel = ({ organizationId }: { organizationId: string | null }) => {
  const [mode, setMode] = useState<Mode>('manual');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('settings')
        .select('delivery_assignment_mode')
        .eq('organization_id', organizationId)
        .maybeSingle();
      const m = ((data as any)?.delivery_assignment_mode || 'manual') as Mode;
      setMode(m === 'free' ? 'free' : 'manual');
      setLoading(false);
    })();
  }, [organizationId]);

  const save = async (next: Mode) => {
    if (!organizationId) return;
    setSaving(true);
    setMode(next);
    const { error } = await supabase
      .from('settings')
      .update({ delivery_assignment_mode: next } as any)
      .eq('organization_id', organizationId);
    setSaving(false);
    if (error) {
      toast.error('Erro ao salvar: ' + error.message);
      return;
    }
    toast.success(
      next === 'manual'
        ? 'Modo Atribuição Manual ativado.'
        : 'Modo Disputa Livre ativado.'
    );
  };

  if (loading) {
    return (
      <div className="px-4 py-10 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  const Option = ({
    value, title, desc, icon: Icon,
  }: { value: Mode; title: string; desc: string; icon: any }) => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => !saving && save(value)}
        className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex gap-3 ${
          active
            ? 'border-primary bg-primary/10 shadow-[0_0_25px_-10px_hsl(var(--primary))]'
            : 'border-border bg-card hover:border-primary/40'
        }`}
      >
        <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
          active ? 'border-primary' : 'border-muted-foreground/40'
        }`}>
          {active && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon className={`w-4 h-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
            <p className={`font-black ${active ? 'text-primary' : 'text-foreground'}`}>{title}</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
        </div>
      </button>
    );
  };

  return (
    <div className="px-4 space-y-4">
      <div className="flex items-center gap-2">
        <Truck className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-black">Configurações de Logística</h2>
        {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />}
      </div>

      <div className="kiosk-card p-4 space-y-3">
        <p className="text-sm font-bold">Modo de Atribuição de Entregas</p>
        <p className="text-xs text-muted-foreground">
          Escolha como os pedidos de entrega serão distribuídos para sua equipe de entregadores.
        </p>

        <div className="space-y-3">
          <Option
            value="manual"
            title="Atribuição Manual (Controle Total)"
            icon={Users}
            desc="O dono ou gerente da loja escolhe exatamente qual entregador receberá cada pedido. Ideal para quem quer organizar a fila de entregas e ter total controle."
          />
          <Option
            value="free"
            title="Disputa Livre (Agilidade Máxima)"
            icon={Zap}
            desc="O pedido aparece para todos os entregadores ativos simultaneamente. O primeiro que aceitar fica com a entrega. Ideal para frotas grandes onde a rapidez é prioridade."
          />
        </div>
      </div>

      <div className="kiosk-card p-4 border border-primary/30 bg-primary/5 flex gap-3">
        <KeyRound className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-bold text-primary">Validação obrigatória com código do cliente</p>
          <p className="text-muted-foreground leading-relaxed">
            Independente do modo escolhido, o entregador <span className="font-semibold text-foreground">sempre precisa digitar o código de 4 dígitos</span> exibido no histórico de pedidos do cliente para confirmar a entrega. Sem o código, o pedido não pode ser marcado como entregue.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LogisticaPanel;
