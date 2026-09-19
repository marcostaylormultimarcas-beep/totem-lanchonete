from pathlib import Path

path = Path('src/components/admin/SenhasPanel.tsx')
s = path.read_text()

s = s.replace("const SENHA_COUNTER_KEY = 'senhas_counter';\n", "")
s = s.replace("  const [counter, setCounter] = useState<number>(() => Number(localStorage.getItem(SENHA_COUNTER_KEY) || '0'));\n", "  const [counter, setCounter] = useState<number>(0);\n")
s = s.replace("  useEffect(() => { localStorage.setItem(SENHA_COUNTER_KEY, String(counter)); }, [counter]);\n", "")

old = """      let numero = (numeroForcado || '').trim();
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
"""
new = """      let numero = (numeroForcado || '').trim();
      if (!numero) {
        const { data, error } = await supabase.rpc('chamar_proxima_senha' as any, {
          _organization_id: organizationId,
          _prefixo: prefix,
          _tipo: tipo,
        });
        if (error) throw error;
        numero = String(data || '');
        const numericPart = Number(numero.replace(/^\\D+/, ''));
        if (Number.isFinite(numericPart)) setCounter(numericPart);
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase.from('senhas_chamadas').insert({
          organization_id: organizationId,
          numero,
          tipo,
          called_by: user?.id || null,
        });
        if (error) throw error;
      }
"""
if old not in s:
    if "chamar_proxima_senha" in s:
        print('already applied')
        raise SystemExit(0)
    raise SystemExit('expected chamar block not found')
s = s.replace(old, new)

old_reset = """  const resetContador = () => {
    if (!confirm('Zerar contador de senhas?')) return;
    setCounter(0);
    toast.success('Contador zerado.');
  };
"""
new_reset = """  const resetContador = async () => {
    if (!organizationId) return;
    if (!confirm('Zerar contador de senhas?')) return;
    const { error } = await supabase.rpc('reset_senha_counter' as any, {
      _organization_id: organizationId,
      _prefixo: prefix,
    });
    if (error) { toast.error(error.message || 'Erro ao zerar contador'); return; }
    setCounter(0);
    toast.success('Contador zerado.');
  };
"""
if old_reset not in s:
    raise SystemExit('expected reset block not found')
s = s.replace(old_reset, new_reset)

path.write_text(s)
