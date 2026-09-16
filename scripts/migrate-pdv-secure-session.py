from pathlib import Path

p = Path('src/pages/PDV.tsx')
s = p.read_text(encoding='utf-8')

repls = [
('import { BRAND_NAME } from "@/config/brandConfig";','import { BRAND_NAME } from "@/config/brandConfig";\nimport { createPdvSession, validatePdvSession, revokePdvSession, savePdvSession, readPdvSession, clearPdvSession, pdvRpc } from "@/lib/pdvSession";'),
('const SESSION_KEY = "pdv_session_v1";\n',''),
('  const [password, setPassword] = useState<string>("");','  const [sessionToken, setSessionToken] = useState<string>("");'),
('''  // Restore session
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
  };''','''  // Restore only an opaque server-issued session token; legacy plaintext-password sessions are discarded.
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
  };'''),
('''        onLogin={(op, pwd, openCaixa) => {
          setOperador(op);
          setPassword(pwd);
          setCaixaId(openCaixa);
        }}''','''        onLogin={(op, token, openCaixa) => {
          setOperador(op);
          setSessionToken(token);
          setCaixaId(openCaixa);
        }}'''),
('password={password}','sessionToken={sessionToken}'),
('password={password}','sessionToken={sessionToken}'),
('onLogin: (op: Operador, password: string, caixaAbertoId: string | null) => void;','onLogin: (op: Operador, sessionToken: string, caixaAbertoId: string | null) => void;'),
('''    const { data, error } = await supabase.rpc("pdv_operador_login", {
      _org_slug: orgSlug.trim().toLowerCase(),
      _username: username.trim().toLowerCase(),
      _password: password,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    const res = data as any;''','''    let res: any;
    try {
      res = await createPdvSession(orgSlug, username, password);
    } catch (error: any) {
      setLoading(false);
      return toast.error(error?.message || "Falha ao entrar");
    }
    setLoading(false);'''),
('onLogin(res.operador, password, res.caixa_aberto_id || null);','onLogin(res.operador, res.session_token, res.caixa_aberto_id || null);'),
('''  password,
  onOpen,''','''  sessionToken,
  onOpen,'''),
('''  password: string;
  onOpen:''','''  sessionToken: string;
  onOpen:'''),
('''    const { data, error } = await supabase.rpc("pdv_abrir_caixa", {
      _operador_id: operador.id,
      _password: password,
      _saldo_inicial: v,
    });''','''    const { data, error } = await pdvRpc.openCash(sessionToken, v);'''),
('''  password,
  caixaId,''','''  sessionToken,
  caixaId,'''),
('''  password: string;
  caixaId: string;''','''  sessionToken: string;
  caixaId: string;'''),
('''    const { data, error } = await supabase.rpc("pdv_registrar_venda", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
      _items: items,
      _forma: forma,
      _total: total,
      _cupom_code: snapCupom,
      _desconto: desconto,
    });''','''    const { data, error } = await pdvRpc.sale(sessionToken, caixaId, items, forma, total, snapCupom, desconto);'''),
('''  operador,
  password,
  caixaId,''','''  operador,
  sessionToken,
  caixaId,'''),
('''  operador: Operador;
  password: string;
  caixaId: string;''','''  operador: Operador;
  sessionToken: string;
  caixaId: string;'''),
('''    const { data, error } = await supabase.rpc("pdv_registrar_movimento", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
      _tipo: tipo,
      _forma: "dinheiro",
      _valor: v,
      _motivo: motivo.trim(),
    });''','''    const { data, error } = await pdvRpc.movement(sessionToken, caixaId, tipo, "dinheiro", v, motivo.trim());'''),
('''    const { data, error } = await supabase.rpc("pdv_devolver_pedido", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
      _order_id: order.id,
      _items_devolvidos: devolvidos,
      _valor_devolucao: valorTotal,
      _motivo: motivo.trim(),
    });''','''    const { data, error } = await pdvRpc.refund(sessionToken, caixaId, order.id, devolvidos, valorTotal, motivo.trim());'''),
('''    const { data, error } = await supabase.rpc("pdv_fechar_caixa", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
    });''','''    const { data, error } = await pdvRpc.closeCash(sessionToken, caixaId);'''),
]

for old, new in repls:
    if old not in s:
        raise SystemExit(f'guard failed; expected block not found:\n{old[:180]}')
    s = s.replace(old, new)

# Safety invariants: no persisted or RPC password remains outside the transient login field.
for forbidden in ['SESSION_KEY', 'setPassword(pwd)', '_password: password', 'pdv_operador_login', 'pdv_abrir_caixa"', 'pdv_registrar_venda"', 'pdv_registrar_movimento"', 'pdv_devolver_pedido"', 'pdv_fechar_caixa"']:
    if forbidden in s:
        raise SystemExit(f'safety invariant failed: {forbidden}')

p.write_text(s, encoding='utf-8')
print('PDV secure-session migration applied with guards')
