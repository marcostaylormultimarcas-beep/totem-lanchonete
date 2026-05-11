import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Pause, Play, Loader2, Building2, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';

interface Org {
  id: string;
  name: string;
  slug: string;
  paused: boolean;
}

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

const OrganizationsPanel = () => {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('organizations').select('*').order('created_at', { ascending: true });
    setOrgs((data as any) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) { toast.error('Informe o nome da loja'); return; }
    const finalSlug = slug.trim() ? slugify(slug) : slugify(name);
    if (!finalSlug) { toast.error('Slug inválido'); return; }
    setSaving(true);
    const { data, error } = await supabase.from('organizations').insert({ name: name.trim(), slug: finalSlug }).select().maybeSingle();
    if (error) {
      toast.error(error.message.includes('duplicate') ? 'Esse slug já existe.' : error.message);
    } else if (data) {
      // create default settings row for the new org
      await supabase.from('settings').insert({ organization_id: data.id, store_name: name.trim() });
      toast.success('Loja criada!');
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
    if (orgs.length <= 1) { toast.error('É necessário pelo menos 1 loja.'); return; }
    if (!confirm(`Remover loja "${o.name}"? Todos os produtos, pedidos e configurações dessa loja serão excluídos.`)) return;
    await supabase.from('organizations').delete().eq('id', o.id);
    await load();
  };

  const rename = async (o: Org, newName: string) => {
    if (!newName.trim() || newName === o.name) return;
    await supabase.from('organizations').update({ name: newName.trim() }).eq('id', o.id);
    await load();
  };

  const totemUrl = (s: string) => `${window.location.origin}/loja/${s}`;

  return (
    <div className="px-4 space-y-4">
      <div className="kiosk-card p-4 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> Nova Loja (Organização)</h3>
        <input placeholder="Nome da loja (ex: Pizzaria do Zé)" value={name} onChange={e => setName(e.target.value)}
          className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={60} />
        <input placeholder="Slug da URL (auto se vazio)" value={slug} onChange={e => setSlug(e.target.value)}
          className="w-full px-3 py-3 bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary" maxLength={50} />
        <button onClick={create} disabled={saving} className="touch-btn w-full bg-success text-success-foreground py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar Loja
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="font-bold text-sm text-muted-foreground">Lojas cadastradas</h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : orgs.map(o => (
          <div key={o.id} className={`kiosk-card p-3 space-y-2 ${o.paused ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Building2 className="w-4 h-4 text-primary flex-shrink-0" />
                <input defaultValue={o.name} onBlur={e => rename(o, e.target.value)}
                  className="font-bold flex-1 bg-transparent outline-none min-w-0" maxLength={60} />
                {o.paused && <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">Pausada</span>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => togglePause(o)} className="p-2 text-muted-foreground hover:text-primary" title={o.paused ? 'Reativar' : 'Pausar'}>
                  {o.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                </button>
                <button onClick={() => remove(o)} className="p-2 text-muted-foreground hover:text-destructive" title="Remover">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(totemUrl(o.slug)); toast.success('Link copiado!'); }}
              className="w-full text-left text-xs text-muted-foreground hover:text-primary flex items-center gap-1 px-1 py-1 rounded">
              <LinkIcon className="w-3 h-3" /> {totemUrl(o.slug)}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OrganizationsPanel;
