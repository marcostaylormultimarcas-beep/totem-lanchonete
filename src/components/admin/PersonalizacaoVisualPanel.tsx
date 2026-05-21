import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Palette, Save, Sun, Moon, Loader2, RotateCcw } from 'lucide-react';
import { applyThemeToRoot, DEFAULT_THEME, type StoreTheme } from '@/hooks/useStoreTheme';

/** Converte HEX (#RRGGBB) para string HSL "h s% l%" usada pelo Tailwind/CSS vars */
function hexToHsl(hex: string): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.substring(0, 2), 16) / 255;
  const g = parseInt(m.substring(2, 4), 16) / 255;
  const b = parseInt(m.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Converte "h s% l%" para HEX para alimentar o <input type="color"> */
function hslToHex(hsl: string): string {
  const [hStr, sStr, lStr] = hsl.split(' ');
  const h = parseFloat(hStr) / 360;
  const s = parseFloat(sStr) / 100;
  const l = parseFloat(lStr) / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

interface Props { organizationId: string | null; }

export default function PersonalizacaoVisualPanel({ organizationId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState<StoreTheme>(DEFAULT_THEME);
  const [msg, setMsg] = useState<string>('');

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('loja_temas' as any)
        .select('primary_color, secondary_color, mode')
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (data) {
        setTheme({
          primary_color: (data as any).primary_color || DEFAULT_THEME.primary_color,
          secondary_color: (data as any).secondary_color || DEFAULT_THEME.secondary_color,
          mode: (data as any).mode === 'light' ? 'light' : 'dark',
        });
      }
      setLoading(false);
    })();
  }, [organizationId]);

  const primaryHex = useMemo(() => hslToHex(theme.primary_color), [theme.primary_color]);
  const secondaryHex = useMemo(() => hslToHex(theme.secondary_color), [theme.secondary_color]);

  const save = async () => {
    if (!organizationId) return;
    setSaving(true);
    setMsg('');
    const payload = {
      organization_id: organizationId,
      primary_color: theme.primary_color,
      secondary_color: theme.secondary_color,
      mode: theme.mode,
    };
    const { error } = await supabase
      .from('loja_temas' as any)
      .upsert(payload, { onConflict: 'organization_id' });
    setSaving(false);
    if (error) {
      setMsg('Erro ao salvar: ' + error.message);
    } else {
      applyThemeToRoot(theme);
      setMsg('Tema salvo e aplicado!');
      setTimeout(() => setMsg(''), 3000);
    }
  };

  const reset = () => setTheme(DEFAULT_THEME);

  if (!organizationId) return <div className="p-6 text-muted-foreground">Selecione uma loja.</div>;
  if (loading) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Carregando tema…</div>;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Palette className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-black">Personalização Visual</h2>
          <p className="text-sm text-muted-foreground">Defina as cores e o modo do seu app. Aplicado apenas à sua loja.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Controles */}
        <div className="kiosk-card p-5 space-y-5">
          <div>
            <label className="text-sm font-bold block mb-2">Cor Primária <span className="text-xs text-muted-foreground font-normal">(botões e destaques)</span></label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={primaryHex}
                onChange={(e) => setTheme(t => ({ ...t, primary_color: hexToHsl(e.target.value) }))}
                className="w-16 h-12 rounded-lg cursor-pointer bg-transparent border border-border"
              />
              <input
                type="text"
                value={primaryHex.toUpperCase()}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) setTheme(t => ({ ...t, primary_color: hexToHsl(v) }));
                }}
                className="flex-1 px-3 py-2 rounded-lg bg-muted border border-border font-mono text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-bold block mb-2">Cor Secundária <span className="text-xs text-muted-foreground font-normal">(elementos de apoio)</span></label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={secondaryHex}
                onChange={(e) => setTheme(t => ({ ...t, secondary_color: hexToHsl(e.target.value) }))}
                className="w-16 h-12 rounded-lg cursor-pointer bg-transparent border border-border"
              />
              <input
                type="text"
                value={secondaryHex.toUpperCase()}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) setTheme(t => ({ ...t, secondary_color: hexToHsl(v) }));
                }}
                className="flex-1 px-3 py-2 rounded-lg bg-muted border border-border font-mono text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-bold block mb-2">Modo do App</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTheme(t => ({ ...t, mode: 'dark' }))}
                className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold transition ${theme.mode === 'dark' ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-muted/40 text-muted-foreground'}`}
              >
                <Moon className="w-4 h-4" /> Dark Mode
              </button>
              <button
                type="button"
                onClick={() => setTheme(t => ({ ...t, mode: 'light' }))}
                className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold transition ${theme.mode === 'light' ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-muted/40 text-muted-foreground'}`}
              >
                <Sun className="w-4 h-4" /> Light Mode
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 min-w-[160px] flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar e Aplicar
            </button>
            <button
              onClick={reset}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-muted text-foreground border border-border font-semibold hover:bg-muted/70"
            >
              <RotateCcw className="w-4 h-4" /> Restaurar padrão
            </button>
          </div>
          {msg && <p className="text-sm font-semibold text-primary">{msg}</p>}
        </div>

        {/* Preview */}
        <div className="kiosk-card p-5">
          <h3 className="text-sm font-bold text-muted-foreground mb-3">Pré-visualização</h3>
          <PreviewBox theme={theme} />
          <p className="text-xs text-muted-foreground mt-3">
            O preview reflete as cores escolhidas. Após salvar, o tema é aplicado em todas as páginas da sua loja.
          </p>
        </div>
      </div>
    </div>
  );
}

function PreviewBox({ theme }: { theme: StoreTheme }) {
  // Cores locais usando style inline para não afetar o resto da tela enquanto o usuário ainda não salvou
  const primary = `hsl(${theme.primary_color})`;
  const secondary = `hsl(${theme.secondary_color})`;
  const isLight = theme.mode === 'light';
  const bg = isLight ? '#fafafa' : '#1c1c1c';
  const fg = isLight ? '#0d0d0d' : '#f5f5f5';
  const card = isLight ? '#ffffff' : '#262626';
  const muted = isLight ? '#6b6b6b' : '#a3a3a3';

  return (
    <div className="rounded-xl overflow-hidden border border-border" style={{ background: bg, color: fg }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ background: primary, color: '#fff' }}>
        <span className="font-black">Minha Loja</span>
        <span className="text-xs opacity-90">Aberto agora</span>
      </div>
      {/* Body */}
      <div className="p-4 space-y-3">
        <div className="rounded-lg p-3" style={{ background: card }}>
          <p className="text-sm font-bold">Hambúrguer Especial</p>
          <p className="text-xs" style={{ color: muted }}>Pão brioche, queijo cheddar, bacon</p>
          <div className="mt-2 flex items-center justify-between">
            <span className="font-black" style={{ color: primary }}>R$ 29,90</span>
            <button className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: primary }}>
              Adicionar
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="flex-1 py-2 rounded-lg text-sm font-bold text-white" style={{ background: primary }}>
            Botão Primário
          </button>
          <button className="flex-1 py-2 rounded-lg text-sm font-bold text-white" style={{ background: secondary }}>
            Botão Secundário
          </button>
        </div>
        <div className="text-xs" style={{ color: muted }}>Texto secundário — descrições, legendas, etc.</div>
      </div>
    </div>
  );
}
