import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface StoreTheme {
  primary_color: string;   // HSL ex: "25 95% 53%"
  secondary_color: string;
  mode: 'dark' | 'light';
}

export const DEFAULT_THEME: StoreTheme = {
  primary_color: '25 95% 53%',
  secondary_color: '0 72% 51%',
  mode: 'dark',
};

/** Aplica as cores e o modo no <html> via CSS variables */
export function applyThemeToRoot(theme: StoreTheme) {
  const root = document.documentElement;
  root.style.setProperty('--primary', theme.primary_color);
  root.style.setProperty('--secondary', theme.secondary_color);
  root.style.setProperty('--ring', theme.primary_color);
  root.style.setProperty('--sidebar-primary', theme.primary_color);
  root.style.setProperty('--sidebar-ring', theme.primary_color);

  if (theme.mode === 'light') {
    root.classList.add('theme-light');
    root.style.setProperty('--background', '0 0% 98%');
    root.style.setProperty('--foreground', '0 0% 10%');
    root.style.setProperty('--card', '0 0% 100%');
    root.style.setProperty('--card-foreground', '0 0% 10%');
    root.style.setProperty('--popover', '0 0% 100%');
    root.style.setProperty('--popover-foreground', '0 0% 10%');
    root.style.setProperty('--muted', '0 0% 94%');
    root.style.setProperty('--muted-foreground', '0 0% 40%');
    root.style.setProperty('--border', '0 0% 88%');
    root.style.setProperty('--input', '0 0% 88%');
    root.style.setProperty('--sidebar-background', '0 0% 96%');
    root.style.setProperty('--sidebar-foreground', '0 0% 10%');
    root.style.setProperty('--sidebar-accent', '0 0% 92%');
    root.style.setProperty('--sidebar-accent-foreground', '0 0% 10%');
    root.style.setProperty('--sidebar-border', '0 0% 88%');
  } else {
    root.classList.remove('theme-light');
    // Reset para os valores do index.css (dark)
    ['--background','--foreground','--card','--card-foreground','--popover','--popover-foreground',
     '--muted','--muted-foreground','--border','--input','--sidebar-background','--sidebar-foreground',
     '--sidebar-accent','--sidebar-accent-foreground','--sidebar-border'].forEach(v => root.style.removeProperty(v));
  }
}

/** Busca o tema da loja (orgId) e aplica globalmente */
export function useStoreTheme(orgId: string | null) {
  const [theme, setTheme] = useState<StoreTheme>(DEFAULT_THEME);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) {
      applyThemeToRoot(DEFAULT_THEME);
      setTheme(DEFAULT_THEME);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('loja_temas' as any)
      .select('primary_color, secondary_color, mode')
      .eq('organization_id', orgId)
      .maybeSingle();
    const next: StoreTheme = data
      ? {
          primary_color: (data as any).primary_color || DEFAULT_THEME.primary_color,
          secondary_color: (data as any).secondary_color || DEFAULT_THEME.secondary_color,
          mode: ((data as any).mode === 'light' ? 'light' : 'dark'),
        }
      : DEFAULT_THEME;
    setTheme(next);
    applyThemeToRoot(next);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  return { theme, setTheme, loading, reload: load };
}
