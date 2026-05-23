import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Boxes, Plus, Trash2, Loader2, AlertTriangle, Link2, RefreshCw, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface Ingrediente {
  id: string;
  nome: string;
  unidade: string;
  estoque_atual: number;
  estoque_minimo: number;
  disponivel: boolean;
}
interface Receita {
  id: string;
  product_id: string;
  ingrediente_id: string;
  quantidade: number;
}
interface Produto { id: string; name: string; available: boolean }
interface Alerta {
  id: string;
  mensagem: string;
  tipo: string;
  resolvido: boolean;
  created_at: string;
  ingrediente_id: string | null;
}

const EstoqueInteligentePanel = ({ organizationId }: { organizationId: string | null }) => {
  const [loading, setLoading] = useState(false);
  const [ings, setIngs] = useState<Ingrediente[]>([]);
  const [recs, setRecs] = useState<Receita[]>([]);
  const [prods, setProds] = useState<Produto[]>([]);
  const [alerts, setAlerts] = useState<Alerta[]>([]);

  const [novoNome, setNovoNome] = useState('');
  const [novaUnidade, setNovaUnidade] = useState('un');
  const [novoEstoque, setNovoEstoque] = useState<number>(0);
  const [novoMin, setNovoMin] = useState<number>(0);

  const [linkProd, setLinkProd] = useState<string>('');
  const [linkIng, setLinkIng] = useState<string>('');
  const [linkQty, setLinkQty] = useState<number>(1);

  const [webhook, setWebhook] = useState('');

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    const [i, r, p, a, s] = await Promise.all([
      supabase.from('ingredientes' as any).select('*').eq('organization_id', organizationId).order('nome'),
      supabase.from('receitas' as any).select('*').eq('organization_id', organizationId),
      supabase.from('products').select('id,name,available').eq('organization_id', organizationId).order('name'),
      supabase.from('alertas_estoque' as any).select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(20),
      supabase.from('settings').select('estoque_webhook_url').eq('organization_id', organizationId).maybeSingle(),
    ]);
    setIngs((i.data as any) || []);
    setRecs((r.data as any) || []);
    setProds((p.data as any) || []);
    setAlerts((a.data as any) || []);
    setWebhook(((s.data as any)?.estoque_webhook_url) || '');
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [organizationId]);

  const recsByProduct = useMemo(() => {
    const m = new Map<string, Receita[]>();
    for (const r of recs) {
      const arr = m.get(r.product_id) || [];
      arr.push(r); m.set(r.product_id, arr);
    }
    return m;
  }, [recs]);

  const addIngrediente = async () => {
    if (!organizationId || !novoNome.trim()) return;
    const { error } = await supabase.from('ingredientes' as any).insert({
      organization_id: organizationId,
      nome: novoNome.trim(), unidade: novaUnidade.trim() || 'un',
      estoque_atual: novoEstoque, estoque_minimo: novoMin,
      disponivel: novoEstoque > 0,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Ingrediente cadastrado');
    setNovoNome(''); setNovoEstoque(0); setNovoMin(0);
    load();
  };

  const removeIngrediente = async (id: string) => {
    if (!confirm('Remover ingrediente? Receitas vinculadas também serão apagadas.')) return;
    await supabase.from('receitas' as any).delete().eq('ingrediente_id', id);
    const { error } = await supabase.from('ingredientes' as any).delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Removido'); load();
  };

  const reabastecer = async (id: string) => {
    const v = prompt('Quantidade a adicionar ao estoque:');
    if (!v) return;
    const n = Number(v.replace(',', '.'));
    if (!isFinite(n) || n <= 0) { toast.error('Quantidade inválida'); return; }
    const { data, error } = await supabase.rpc('reabastecer_ingrediente' as any, { _id: id, _quantidade: n });
    if (error) { toast.error(error.message); return; }
    if (!(data as any)?.ok) { toast.error((data as any)?.reason || 'Falhou'); return; }
    toast.success('Estoque reposto. Produtos reativados.');
    load();
  };

  const linkReceita = async () => {
    if (!organizationId || !linkProd || !linkIng || linkQty <= 0) return;
    const { error } = await supabase.from('receitas' as any).upsert({
      organization_id: organizationId,
      product_id: linkProd, ingrediente_id: linkIng, quantidade: linkQty,
    }, { onConflict: 'product_id,ingrediente_id' });
    if (error) { toast.error(error.message); return; }
    toast.success('Receita vinculada');
    load();
  };

  const removeReceita = async (id: string) => {
    await supabase.from('receitas' as any).delete().eq('id', id);
    load();
  };

  const saveWebhook = async () => {
    if (!organizationId) return;
    const { error } = await supabase.from('settings').update({ estoque_webhook_url: webhook } as any)
      .eq('organization_id', organizationId);
    if (error) { toast.error(error.message); return; }
    toast.success('Webhook salvo');
  };

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-2xl p-6 border border-border">
        <div className="flex items-center gap-3 mb-1">
          <Boxes className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-bold">Estoque Inteligente</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Cadastre ingredientes, vincule receitas aos produtos e o sistema desconta automaticamente a cada pedido.
          Quando um ingrediente acaba, os produtos relacionados são bloqueados no totem.
        </p>
      </div>

      {/* Webhook */}
      <div className="bg-card rounded-2xl p-6 border border-border">
        <h3 className="font-semibold mb-2">Alerta de ruptura (Webhook)</h3>
        <p className="text-xs text-muted-foreground mb-3">
          URL chamada quando um produto for desativado por falta de ingrediente. Suporta Push, WhatsApp ou qualquer endpoint próprio.
        </p>
        <div className="flex gap-2">
          <input className="flex-1 px-3 py-2 rounded-lg bg-background border border-input text-sm"
            placeholder="https://seu-webhook.com/alerta" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
          <button onClick={saveWebhook} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Salvar</button>
        </div>
      </div>

      {/* Cadastro de ingrediente */}
      <div className="bg-card rounded-2xl p-6 border border-border">
        <h3 className="font-semibold mb-3">Cadastrar ingrediente</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Nome</label>
            <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm" placeholder="Ex: Pão de hambúrguer" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Unidade</label>
            <input value={novaUnidade} onChange={(e) => setNovaUnidade(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm" placeholder="un, kg, L" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Estoque inicial</label>
            <input type="number" value={novoEstoque} onChange={(e) => setNovoEstoque(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Mínimo</label>
            <input type="number" value={novoMin} onChange={(e) => setNovoMin(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm" />
          </div>
          <button onClick={addIngrediente}
            className="col-span-2 md:col-span-5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm inline-flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </div>
      </div>

      {/* Lista de ingredientes */}
      <div className="bg-card rounded-2xl p-6 border border-border">
        <h3 className="font-semibold mb-3">Ingredientes</h3>
        {loading ? (
          <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : ings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum ingrediente cadastrado ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2">Nome</th><th>Estoque</th><th>Mínimo</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {ings.map(i => {
                  const low = i.estoque_atual <= i.estoque_minimo;
                  return (
                    <tr key={i.id} className="border-b border-border/40">
                      <td className="py-2 font-medium">{i.nome}</td>
                      <td>{i.estoque_atual} {i.unidade}</td>
                      <td>{i.estoque_minimo}</td>
                      <td>
                        {!i.disponivel ? (
                          <span className="inline-flex items-center gap-1 text-xs text-red-400">
                            <AlertTriangle className="w-3 h-3" /> Esgotado
                          </span>
                        ) : low ? (
                          <span className="text-xs text-amber-400">Baixo</span>
                        ) : (
                          <span className="text-xs text-emerald-400">OK</span>
                        )}
                      </td>
                      <td className="text-right space-x-1">
                        <button onClick={() => reabastecer(i.id)} className="px-2 py-1 rounded bg-muted hover:bg-muted/70 text-xs inline-flex items-center gap-1">
                          <RefreshCw className="w-3 h-3" /> Repor
                        </button>
                        <button onClick={() => removeIngrediente(i.id)} className="px-2 py-1 rounded bg-destructive/20 text-destructive text-xs">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Vincular receita */}
      <div className="bg-card rounded-2xl p-6 border border-border">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Link2 className="w-4 h-4" /> Vincular ingrediente a produto</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs text-muted-foreground">Produto</label>
            <select value={linkProd} onChange={(e) => setLinkProd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm">
              <option value="">Selecione…</option>
              {prods.map(p => <option key={p.id} value={p.id}>{p.name}{!p.available && ' (bloqueado)'}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Ingrediente</label>
            <select value={linkIng} onChange={(e) => setLinkIng(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm">
              <option value="">Selecione…</option>
              {ings.map(i => <option key={i.id} value={i.id}>{i.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Qtd. por pedido</label>
            <input type="number" step="0.01" min={0.01} value={linkQty} onChange={(e) => setLinkQty(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm" />
          </div>
          <button onClick={linkReceita} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">
            Vincular
          </button>
        </div>

        {prods.filter(p => recsByProduct.has(p.id)).length > 0 && (
          <div className="mt-5 space-y-2">
            {prods.filter(p => recsByProduct.has(p.id)).map(p => (
              <div key={p.id} className="rounded-lg border border-border p-3">
                <div className="font-medium text-sm mb-1">{p.name}</div>
                <div className="flex flex-wrap gap-2">
                  {(recsByProduct.get(p.id) || []).map(r => {
                    const i = ings.find(x => x.id === r.ingrediente_id);
                    return (
                      <span key={r.id} className="inline-flex items-center gap-2 px-2 py-1 rounded bg-muted text-xs">
                        {i?.nome || '?'} × {r.quantidade}
                        <button onClick={() => removeReceita(r.id)} className="text-destructive"><Trash2 className="w-3 h-3" /></button>
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alertas */}
      <div className="bg-card rounded-2xl p-6 border border-border">
        <h3 className="font-semibold mb-3">Alertas recentes</h3>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem alertas. Tudo abastecido.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {alerts.map(a => (
              <li key={a.id} className={`p-3 rounded-lg border ${a.resolvido ? 'border-border/40 opacity-70' : 'border-amber-500/30 bg-amber-500/5'}`}>
                <div className="flex items-start gap-2">
                  {a.resolvido ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5" />}
                  <div className="flex-1">
                    <div>{a.mensagem}</div>
                    <div className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString('pt-BR')}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default EstoqueInteligentePanel;
