from pathlib import Path

p = Path('src/pages/PDV.tsx')
s = p.read_text(encoding='utf-8')


def once(old: str, new: str, label: str):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'guard failed [{label}]: expected exactly 1 match, got {count}')
    s = s.replace(old, new, 1)


def all_matches(old: str, new: str, expected: int, label: str):
    global s
    count = s.count(old)
    if count != expected:
        raise SystemExit(f'guard failed [{label}]: expected {expected} matches, got {count}')
    s = s.replace(old, new)

once('import { BRAND_NAME } from "@/config/brandConfig";', 'import { BRAND_NAME } from "@/config/brandConfig";\nimport { createPdvSession, validatePdvSession, revokePdvSession, savePdvSession, readPdvSession, clearPdvSession, pdvRpc } from "@/lib/pdvSession";', 'import')
once('const SESSION_KEY = "pdv_session_v1";\n', '', 'legacy key')
once('  const [password, setPassword] = useState<string>("");', '  const [sessionToken, setSessionToken] = useState<string>("");', 'parent password state')

old_restore = '''  // Restore session
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s?.operador && s?.password) {
          setOperador(s.operador);
          setPassword(s.password);
          setCaixaId(s.caixaId || null);
        }
      }
    } catch {}
    setBooting(false);
  }, []);

  useEffect(() => {
    if (operador) {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ operador, password, caixaId }),
      );
    }
  }, [operador, password, caixaId]);

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setOperador(null);
    setPassword("");
    setCaixaId(null);
  };'''
new_restore = '''  // Restore only an opaque server-issued session token; legacy plaintext-password sessions are discarded.
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
        } else if (!ctx) {
          clearPdvSession();
        }
      }
      if (active) setBooting(false);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (operador && sessionToken) {
      savePdvSession({ operador, sessionToken, caixaId });
    }
  }, [operador, sessionToken, caixaId]);

  const logout = () => {
    if (sessionToken) void revokePdvSession(sessionToken);
    clearPdvSession();
    setOperador(null);
    setSessionToken("");
    setCaixaId(null);
  };'''
once(old_restore, new_restore, 'restore/persist/logout')

once('''        onLogin={(op, pwd, openCaixa) => {
          setOperador(op);
          setPassword(pwd);
          setCaixaId(openCaixa);
        }}''', '''        onLogin={(op, token, openCaixa) => {
          setOperador(op);
          setSessionToken(token);
          setCaixaId(openCaixa);
        }}''', 'login callback')

# Parent renders: Abertura + PDVMain. Modal props are handled separately below.
all_matches('        password={password}\n', '        sessionToken={sessionToken}\n', 2, 'parent session props')

once('onLogin: (op: Operador, password: string, caixaAbertoId: string | null) => void;', 'onLogin: (op: Operador, sessionToken: string, caixaAbertoId: string | null) => void;', 'login type')

old_login_rpc = '''    const { data, error } = await supabase.rpc("pdv_operador_login", {
      _org_slug: orgSlug.trim().toLowerCase(),
      _username: username.trim().toLowerCase(),
      _password: password,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    const res = data as any;'''
new_login_rpc = '''    let res: any;
    try {
      res = await createPdvSession(orgSlug, username, password);
    } catch (error: any) {
      setLoading(false);
      return toast.error(error?.message || "Falha ao entrar");
    }
    setLoading(false);'''
once(old_login_rpc, new_login_rpc, 'login rpc')
once('onLogin(res.operador, password, res.caixa_aberto_id || null);', 'onLogin(res.operador, res.session_token, res.caixa_aberto_id || null);', 'login token')

once('''function AberturaScreen({
  operador,
  password,
  onOpen,''', '''function AberturaScreen({
  operador,
  sessionToken,
  onOpen,''', 'abertura params')
once('''  operador: Operador;
  password: string;
  onOpen: (caixaId: string) => void;''', '''  operador: Operador;
  sessionToken: string;
  onOpen: (caixaId: string) => void;''', 'abertura type')
once('''    const { data, error } = await supabase.rpc("pdv_abrir_caixa", {
      _operador_id: operador.id,
      _password: password,
      _saldo_inicial: v,
    });''', '    const { data, error } = await pdvRpc.openCash(sessionToken, v);', 'open cash')

once('''function PDVMain({
  operador,
  password,
  caixaId,''', '''function PDVMain({
  operador,
  sessionToken,
  caixaId,''', 'main params')
once('''  operador: Operador;
  password: string;
  caixaId: string;
  onClose: () => void;''', '''  operador: Operador;
  sessionToken: string;
  caixaId: string;
  onClose: () => void;''', 'main type')

old_sale = '''    const { data, error } = await supabase.rpc("pdv_registrar_venda", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
      _items: items,
      _forma: forma,
      _total: total,
      _cupom_code: snapCupom,
      _desconto: desconto,
    });'''
once(old_sale, '    const { data, error } = await pdvRpc.sale(sessionToken, caixaId, items, forma, total, snapCupom, desconto);', 'sale')

# Three modal invocations.
all_matches('          password={password}\n', '          sessionToken={sessionToken}\n', 3, 'modal session props')

for name in ['SangriaModal', 'DevolucaoModal', 'FechamentoModal']:
    once(f'''function {name}({{
  operador,
  password,
  caixaId,''', f'''function {name}({{
  operador,
  sessionToken,
  caixaId,''', f'{name} params')

# There are three identical modal prop type fragments.
all_matches('''  operador: Operador;
  password: string;
  caixaId: string;''', '''  operador: Operador;
  sessionToken: string;
  caixaId: string;''', 3, 'modal types')

old_movement = '''    const { data, error } = await supabase.rpc("pdv_registrar_movimento", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
      _tipo: tipo,
      _forma: "dinheiro",
      _valor: v,
      _motivo: motivo.trim(),
    });'''
once(old_movement, '    const { data, error } = await pdvRpc.movement(sessionToken, caixaId, tipo, "dinheiro", v, motivo.trim());', 'movement')

old_refund = '''    const { data, error } = await supabase.rpc("pdv_devolver_pedido", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
      _order_id: order.id,
      _items_devolvidos: devolvidos,
      _valor_devolucao: valorTotal,
      _motivo: motivo.trim(),
    });'''
once(old_refund, '    const { data, error } = await pdvRpc.refund(sessionToken, caixaId, order.id, devolvidos, valorTotal, motivo.trim());', 'refund')

old_close = '''    const { data, error } = await supabase.rpc("pdv_fechar_caixa", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
    });'''
once(old_close, '    const { data, error } = await pdvRpc.closeCash(sessionToken, caixaId);', 'close')

# Safety invariants: password may remain only as the transient LoginScreen input.
for forbidden in ['SESSION_KEY', 'setPassword(pwd)', '_password: password', 'pdv_operador_login', 'pdv_abrir_caixa"', 'pdv_registrar_venda"', 'pdv_registrar_movimento"', 'pdv_devolver_pedido"', 'pdv_fechar_caixa"']:
    if forbidden in s:
        raise SystemExit(f'safety invariant failed: {forbidden}')

if s.count('const [password, setPassword] = useState("");') != 1:
    raise SystemExit('safety invariant failed: expected exactly one transient login password state')

p.write_text(s, encoding='utf-8')
print('PDV secure-session migration applied with deterministic guards')
