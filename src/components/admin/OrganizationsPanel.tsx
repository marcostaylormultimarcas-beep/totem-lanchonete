import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Pause, Play, Loader2, Building2, Link as LinkIcon, Layers, ChevronDown, ChevronUp, Save, MapPin, Phone, FileText, Instagram } from 'lucide-react';
import { toast } from 'sonner';

interface Org {
  id: string;
  name: string;
  slug: string;
  paused: boolean;
  plan_id: string | null;
  cnpj?: string;
  telefone?: string;
  instagram?: string;
  city?: string;
  endereco_cep?: string;
  endereco_rua?: string;
  endereco_numero?: string;
  endereco_bairro?: string;
  endereco_estado?: string;
}

interface Plan { id: string; key: string; name: string; sort_order: number; }

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

const maskCNPJ = (v: string) => v.replace(/\D/g, '').slice(0, 14)
  .replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
  .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');

const maskCEP = (v: string) => v.replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');

const maskPhone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{0,2})(\d{0,4})(\d{0,4}).*/, (_, a, b, c) => [a && `(${a})`, b, c].filter(Boolean).join(' ').trim());
  return d.replace(/^(\d{2})(\d{5})(\d{4}).*/, '($1) $2-$3');
};

const UF = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const UnidadeFicha = ({ org, onSaved }: { org: Org; onSaved: () => void }) => {
  const [form, setForm] = useState({
    cnpj: org.cnpj || '',
    telefone: org.telefone || '',
    instagram: org.instagram || '',
    endereco_cep: org.endereco_cep || '',
    endereco_rua: org.endereco_rua || '',
    endereco_numero: org.endereco_numero || '',
    endereco_bairro: org.endereco_bairro || '',
    city: org.city || '',
    endereco_estado: org.endereco_estado || '',
  });
  const [saving, setSaving] = useState(false);

  const upd = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const buscarCep = async (cep: string) => {
    const clean = cep.replace(/\D/g, '');
    if (clean.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const d = await r.json();
      if (d.erro) return;
      setForm(f => ({
        ...f,
        endereco_rua: d.logradouro || f.endereco_rua,
        endereco_bairro: d.bairro || f.endereco_bairro,
        city: d.localidade || f.city,
        endereco_estado: d.uf || f.endereco_estado,
      }));
    } catch {/* ignore */}
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('organizations').update({
      cnpj: form.cnpj,
      telefone: form.telefone,
      instagram: form.instagram.trim(),
      endereco_cep: form.endereco_cep,
      endereco_rua: form.endereco_rua,
      endereco_numero: form.endereco_numero,
      endereco_bairro: form.endereco_bairro,
      city: form.city,
      endereco_estado: form.endereco_estado,
    } as any).eq('id', org.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Ficha da unidade salva!');
    onSaved();
  };

  return (
    <div className="mt-2 pt-3 border-t border-border/40 space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 col-span-2">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1"><FileText className="w-3 h-3" /> CNPJ</span>
          <input value={form.cnpj} onChange={e => upd('cnpj', maskCNPJ(e.target.value))} placeholder="00.000.000/0000-00"
            className="w-full px-2.5 py-2 bg-muted rounded-md text-sm outline-none focus:ring-2 focus:ring-primary" />
        </label>
        <label className="space-y-1 col-span-2">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Phone className="w-3 h-3" /> Telefone da unidade</span>
          <input value={form.telefone} onChange={e => upd('telefone', maskPhone(e.target.value))} placeholder="(62) 99999-9999"
            className="w-full px-2.5 py-2 bg-muted rounded-md text-sm outline-none focus:ring-2 focus:ring-primary" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1"><MapPin className="w-3 h-3" /> CEP</span>
          <input value={form.endereco_cep} onChange={e => { const v = maskCEP(e.target.value); upd('endereco_cep', v); if (v.length === 9) buscarCep(v); }}
            placeholder="00000-000"
            className="w-full px-2.5 py-2 bg-muted rounded-md text-sm outline-none focus:ring-2 focus:ring-primary" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">UF</span>
          <select value={form.endereco_estado} onChange={e => upd('endereco_estado', e.target.value)}
            className="w-full px-2.5 py-2 bg-muted rounded-md text-sm outline-none focus:ring-2 focus:ring-primary">
            <option value="">—</option>
            {UF.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label className="space-y-1 col-span-2">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Rua / Logradouro</span>
          <input value={form.endereco_rua} onChange={e => upd('endereco_rua', e.target.value)}
            className="w-full px-2.5 py-2 bg-muted rounded-md text-sm outline-none focus:ring-2 focus:ring-primary" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Número</span>
          <input value={form.endereco_numero} onChange={e => upd('endereco_numero', e.target.value)}
            className="w-full px-2.5 py-2 bg-muted rounded-md text-sm outline-none focus:ring-2 focus:ring-primary" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Bairro</span>
          <input value={form.endereco_bairro} onChange={e => upd('endereco_bairro', e.target.value)}
            className="w-full px-2.5 py-2 bg-muted rounded-md text-sm outline-none focus:ring-2 focus:ring-primary" />
        </label>
        <label className="space-y-1 col-span-2">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Cidade</span>
          <input value={form.city} onChange={e => upd('city', e.target.value)}
            className="w-full px-2.5 py-2 bg-muted rounded-md text-sm outline-none focus:ring-2 focus:ring-primary" />
        </label>
      </div>
      <button onClick={save} disabled={saving}
        className="touch-btn w-full bg-amber-500 text-zinc-950 font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar ficha
      </button>
    </div>
  );
};

const OrganizationsPanel = () => {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [planId, setPlanId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    const [{ data: orgsData }, { data: plansData }] = await Promise.all([
      supabase.from('organizations').select('*').order('created_at', { ascending: true }),
      supabase.from('plans' as any).select('id, key, name, sort_order').order('sort_order'),
    ]);
    setOrgs((orgsData as any) || []);
    const pl = (plansData as any as Plan[]) || [];
    setPlans(pl);
    if (!planId && pl.length) setPlanId(pl[0].id);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) { toast.error('Informe o nome da unidade'); return; }
    const finalSlug = slug.trim() ? slugify(slug) : slugify(name);
    if (!finalSlug) { toast.error('Slug inválido'); return; }
    setSaving(true);
    const { data, error } = await supabase.from('organizations')
      .insert({ name: name.trim(), slug: finalSlug, plan_id: planId || null } as any)
      .select().maybeSingle();
    if (error) {
      toast.error(error.message.includes('duplicate') ? 'Esse slug já existe.' : error.message);
    } else if (data) {
      await supabase.from('settings').insert({ organization_id: data.id, store_name: name.trim() });
      toast.success('Unidade criada!');
      setName(''); setSlug('');
      await load();
    }
    setSaving(false);
  };

  const togglePause = async (o: Org) => {
    await supabase.from('organizations').update({ paused: !o.paused }).eq('id', o.id);
    await load();
  };

  const remove = async (o: Org) => {
    if (orgs.length <= 1) { toast.error('É necessário pelo menos 1 unidade.'); return; }
    if (!confirm(`Remover unidade "${o.name}"? Todos os produtos, pedidos e configurações dessa loja serão excluídos.`)) return;
    await supabase.from('organizations').delete().eq('id', o.id);
    await load();
  };

  const rename = async (o: Org, newName: string) => {
    if (!newName.trim() || newName === o.name) return;
    await supabase.from('organizations').update({ name: newName.trim() }).eq('id', o.id);
    await load();
  };

  const changePlan = async (o: Org, newPlanId: string) => {
    if (newPlanId === (o.plan_id || '')) return;
    const { error } = await supabase.from('organizations').update({ plan_id: newPlanId || null } as any).eq('id', o.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Plano atualizado!');
    await load();
  };

  const totemUrl = (s: string) => `${window.location.origin}/cardapio/${s}`;

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  return (
    <div className="px-4 space-y-4">
      <div className="kiosk-card p-4 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> Nova Unidade (Franquia)</h3>
        <input placeholder="Nome da unidade (ex: Anápolis Centro)" value={name} onChange={e => setName(e.target.value)}
          className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={60} />
        <input placeholder="Slug da URL (auto se vazio)" value={slug} onChange={e => setSlug(e.target.value)}
          className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={50} />
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" /> Plano da unidade
          </label>
          <select value={planId} onChange={e => setPlanId(e.target.value)}
            className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary">
            {plans.length === 0 && <option value="">Nenhum plano cadastrado</option>}
            {plans.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <button onClick={create} disabled={saving} className="touch-btn w-full bg-success text-success-foreground py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar Unidade
        </button>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          💡 Após criar, clique em <strong>Editar ficha</strong> em cada unidade para preencher CNPJ, telefone e endereço completo.
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="font-bold text-sm text-muted-foreground">Unidades cadastradas ({orgs.length})</h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : orgs.map(o => (
          <div key={o.id} className={`kiosk-card p-3 space-y-2 ${o.paused ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Building2 className="w-4 h-4 text-primary flex-shrink-0" />
                <input defaultValue={o.name} onBlur={e => rename(o, e.target.value)}
                  className="font-bold flex-1 bg-transparent outline-none min-w-0" maxLength={60} />
                {o.paused
                  ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">Inativa</span>
                  : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/20 text-success">Ativa</span>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => togglePause(o)} className="p-2 text-muted-foreground hover:text-primary" title={o.paused ? 'Ativar' : 'Desativar'}>
                  {o.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                </button>
                <button onClick={() => remove(o)} className="p-2 text-muted-foreground hover:text-destructive" title="Remover">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {(o.cnpj || o.telefone || o.city) && (
              <div className="text-[11px] text-muted-foreground space-y-0.5">
                {o.cnpj && <div>📄 CNPJ {o.cnpj}</div>}
                {o.telefone && <div>📞 {o.telefone}</div>}
                {(o.endereco_rua || o.city) && (
                  <div>📍 {[o.endereco_rua, o.endereco_numero].filter(Boolean).join(', ')}{o.endereco_bairro ? ` · ${o.endereco_bairro}` : ''}{o.city ? ` · ${o.city}` : ''}{o.endereco_estado ? `/${o.endereco_estado}` : ''}</div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <select value={o.plan_id || ''} onChange={e => changePlan(o, e.target.value)}
                className="text-xs px-2 py-1.5 bg-muted rounded-md outline-none flex-1 focus:ring-2 focus:ring-primary">
                <option value="">Sem plano</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <button onClick={() => { navigator.clipboard.writeText(totemUrl(o.slug)); toast.success('Link copiado!'); }}
              className="w-full text-left text-xs text-muted-foreground hover:text-primary flex items-center gap-1 px-1 py-1 rounded">
              <LinkIcon className="w-3 h-3" /> {totemUrl(o.slug)}
            </button>

            <button onClick={() => toggleExpand(o.id)}
              className="w-full text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center justify-center gap-1 py-1.5 rounded-md hover:bg-amber-500/10 transition">
              {expanded.has(o.id) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {expanded.has(o.id) ? 'Fechar ficha' : 'Editar ficha (CNPJ, endereço, telefone)'}
            </button>

            {expanded.has(o.id) && <UnidadeFicha org={o} onSaved={load} />}
          </div>
        ))}
      </div>
    </div>
  );
};

export default OrganizationsPanel;
