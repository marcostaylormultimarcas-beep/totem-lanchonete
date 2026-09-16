from pathlib import Path

p = Path('src/pages/PDV.tsx')
s = p.read_text(encoding='utf-8')

def once(old, new, label):
    global s
    n=s.count(old)
    if n!=1: raise SystemExit(f'guard failed [{label}]: expected 1, got {n}')
    s=s.replace(old,new,1)

def exact(old,new,n,label):
    global s
    got=s.count(old)
    if got!=n: raise SystemExit(f'guard failed [{label}]: expected {n}, got {got}')
    s=s.replace(old,new)

once('import { BRAND_NAME } from "@/config/brandConfig";', 'import { BRAND_NAME } from "@/config/brandConfig";\nimport { createPdvSession, validatePdvSession, revokePdvSession, savePdvSession, readPdvSession, clearPdvSession, pdvRpc } from "@/lib/pdvSession";', 'import')
once('const SESSION_KEY = "pdv_session_v1";\n','', 'legacy key')
once('  const [password, setPassword] = useState<string>("");','  const [sessionToken, setSessionToken] = useState<string>("");','parent password')

start=s.index('  // Restore session')
end=s.index('\n\n  if (booting)', start)
old=s[start:end]
if 'localStorage.getItem(SESSION_KEY)' not in old or 'JSON.stringify({ operador, password, caixaId })' not in old:
    raise SystemExit('guard failed [restore]: unexpected legacy session block')
new='''  // Restore only an opaque server-issued session token; discard legacy password persistence.
  useEffect(() => {
    let active = true;
    (async () => {
      localStorage.removeItem("pdv_session_v1");
      const saved = readPdvSession();
      if (saved) {
        const ctx = await validatePdvSession(saved.sessionToken);
        if (active && ctx) {
          setOperador(saved.operador as Operador);
          setSessionToken(saved.sessionToken);
          setCaixaId(saved.caixaId || ctx.caixa_aberto_id || null);
        } else if (!ctx) clearPdvSession();
      }
      if (active) setBooting(false);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (operador && sessionToken) savePdvSession({ operador, sessionToken, caixaId });
  }, [operador, sessionToken, caixaId]);

  const logout = () => {
    if (sessionToken) void revokePdvSession(sessionToken);
    clearPdvSession();
    setOperador(null);
    setSessionToken("");
    setCaixaId(null);
  };'''
s=s[:start]+new+s[end:]

once('''        onLogin={(op, pwd, openCaixa) => {
          setOperador(op);
          setPassword(pwd);
          setCaixaId(openCaixa);
        }}''','''        onLogin={(op, token, openCaixa) => {
          setOperador(op);
          setSessionToken(token);
          setCaixaId(openCaixa);
        }}''','callback')
# Exactly four JSX password props exist in the current PDV and all are security-sensitive child props.
exact('password={password}', 'sessionToken={sessionToken}', 4, 'jsx props')
once('onLogin: (op: Operador, password: string, caixaAbertoId: string | null) => void;', 'onLogin: (op: Operador, sessionToken: string, caixaAbertoId: string | null) => void;', 'login type')

old='''    const { data, error } = await supabase.rpc("pdv_operador_login", {
      _org_slug: orgSlug.trim().toLowerCase(),
      _username: username.trim().toLowerCase(),
      _password: password,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    const res = data as any;'''
new='''    let res: any;
    try { res = await createPdvSession(orgSlug, username, password); }
    catch (error: any) { setLoading(false); return toast.error(error?.message || "Falha ao entrar"); }
    setLoading(false);'''
once(old,new,'login rpc')
once('onLogin(res.operador, password, res.caixa_aberto_id || null);','onLogin(res.operador, res.session_token, res.caixa_aberto_id || null);','token return')

# Function destructuring and prop types: one Abertura, one PDVMain and three modal components.
exact('\n  password,\n', '\n  sessionToken,\n', 5, 'component destructuring')
exact('  password: string;\n', '  sessionToken: string;\n', 5, 'component prop types')

old='''    const { data, error } = await supabase.rpc("pdv_abrir_caixa", {
      _operador_id: operador.id,
      _password: password,
      _saldo_inicial: v,
    });'''
once(old,'    const { data, error } = await pdvRpc.openCash(sessionToken, v);','open')
old='''    const { data, error } = await supabase.rpc("pdv_registrar_venda", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
      _items: items,
      _forma: forma,
      _total: total,
      _cupom_code: snapCupom,
      _desconto: desconto,
    });'''
once(old,'    const { data, error } = await pdvRpc.sale(sessionToken, caixaId, items, forma, total, snapCupom, desconto);','sale')
old='''    const { data, error } = await supabase.rpc("pdv_registrar_movimento", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
      _tipo: tipo,
      _forma: "dinheiro",
      _valor: v,
      _motivo: motivo.trim(),
    });'''
once(old,'    const { data, error } = await pdvRpc.movement(sessionToken, caixaId, tipo, "dinheiro", v, motivo.trim());','movement')
old='''    const { data, error } = await supabase.rpc("pdv_devolver_pedido", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
      _order_id: order.id,
      _items_devolvidos: devolvidos,
      _valor_devolucao: valorTotal,
      _motivo: motivo.trim(),
    });'''
once(old,'    const { data, error } = await pdvRpc.refund(sessionToken, caixaId, order.id, devolvidos, valorTotal, motivo.trim());','refund')
old='''    const { data, error } = await supabase.rpc("pdv_fechar_caixa", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
    });'''
once(old,'    const { data, error } = await pdvRpc.closeCash(sessionToken, caixaId);','close')

for forbidden in ['SESSION_KEY','setPassword(pwd)','_password: password','pdv_operador_login','pdv_abrir_caixa"','pdv_registrar_venda"','pdv_registrar_movimento"','pdv_devolver_pedido"','pdv_fechar_caixa"']:
    if forbidden in s: raise SystemExit(f'safety invariant failed: {forbidden}')
if s.count('const [password, setPassword] = useState("");') != 1:
    raise SystemExit('safety invariant failed: transient login password state')
p.write_text(s,encoding='utf-8')
print('PDV secure-session migration applied')
