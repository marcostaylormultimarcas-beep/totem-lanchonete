import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  LogIn,
  LogOut,
  Banknote,
  ArrowDownCircle,
  ArrowUpCircle,
  Trash2,
  Plus,
  Minus,
  Search,
  Ticket,
  RotateCcw,
  Lock,
  Receipt,
  Loader2,
} from "lucide-react";

type Operador = {
  id: string;
  name: string;
  username: string;
  organization_id: string;
  org_slug: string;
  org_name: string;
};

type Product = {
  id: string;
  name: string;
  price: number;
  codigo_barras: string | null;
  available: boolean;
  image?: string | null;
};

type CartItem = {
  id: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
};

type Forma = "dinheiro" | "pix" | "cartao";

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const SESSION_KEY = "pdv_session_v1";

export default function PDV() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [operador, setOperador] = useState<Operador | null>(null);
  const [password, setPassword] = useState<string>("");
  const [caixaId, setCaixaId] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  // Restore session
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
  };

  if (booting) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!operador) {
    return (
      <LoginScreen
        slug={slug}
        onLogin={(op, pwd, openCaixa) => {
          setOperador(op);
          setPassword(pwd);
          setCaixaId(openCaixa);
        }}
      />
    );
  }

  if (!caixaId) {
    return (
      <AberturaScreen
        operador={operador}
        password={password}
        onOpen={(id) => setCaixaId(id)}
        onLogout={logout}
      />
    );
  }

  return (
    <PDVMain
      operador={operador}
      password={password}
      caixaId={caixaId}
      onClose={() => {
        setCaixaId(null);
      }}
      onLogout={logout}
    />
  );
}

/* ------------------------------ LOGIN ------------------------------ */

function LoginScreen({
  slug,
  onLogin,
}: {
  slug?: string;
  onLogin: (op: Operador, password: string, caixaAbertoId: string | null) => void;
}) {
  const [orgSlug, setOrgSlug] = useState(slug || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgSlug || !username || !password) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("pdv_operador_login", {
      _org_slug: orgSlug.trim().toLowerCase(),
      _username: username.trim().toLowerCase(),
      _password: password,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    const res = data as any;
    if (!res?.ok) {
      toast.error(
        res?.reason === "org_not_found"
          ? "Loja não encontrada"
          : "Usuário ou senha inválidos",
      );
      return;
    }
    toast.success(`Bem-vindo, ${res.operador.name}`);
    onLogin(res.operador, password, res.caixa_aberto_id || null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 space-y-5 shadow-2xl"
      >
        <div className="text-center space-y-1">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <Lock className="w-7 h-7 text-amber-500" />
          </div>
          <h1 className="text-2xl font-bold text-white">PDV — Balcão</h1>
          <p className="text-sm text-zinc-400">Acesso restrito a operadores</p>
        </div>

        <input
          value={orgSlug}
          onChange={(e) => setOrgSlug(e.target.value)}
          placeholder="Identificador da loja (slug)"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 outline-none"
          autoCapitalize="none"
        />
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Usuário"
          autoComplete="username"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 outline-none"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha"
          type="password"
          autoComplete="current-password"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 outline-none"
        />

        <button
          disabled={loading}
          className="w-full touch-btn rounded-xl bg-amber-500 text-zinc-950 font-bold py-3 inline-flex items-center justify-center gap-2 hover:bg-amber-400 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          Entrar
        </button>
      </form>
    </div>
  );
}

/* ----------------------------- ABERTURA ---------------------------- */

function AberturaScreen({
  operador,
  password,
  onOpen,
  onLogout,
}: {
  operador: Operador;
  password: string;
  onOpen: (caixaId: string) => void;
  onLogout: () => void;
}) {
  const [valor, setValor] = useState<string>("0,00");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = parseFloat(valor.replace(/\./g, "").replace(",", ".")) || 0;
    setLoading(true);
    const { data, error } = await supabase.rpc("pdv_abrir_caixa", {
      _operador_id: operador.id,
      _password: password,
      _saldo_inicial: v,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    const res = data as any;
    if (!res?.ok) {
      toast.error(res?.reason === "already_open" ? "Já existe um caixa aberto" : "Erro ao abrir caixa");
      return;
    }
    toast.success("Caixa aberto");
    onOpen(res.caixa_id);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 space-y-5"
      >
        <div className="text-center space-y-1">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <Banknote className="w-7 h-7 text-amber-500" />
          </div>
          <h1 className="text-xl font-bold text-white">Abertura de Caixa</h1>
          <p className="text-sm text-zinc-400">
            Operador: <b className="text-amber-400">{operador.name}</b>
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1">
            Saldo inicial (troco)
          </label>
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-2xl font-bold text-white text-right focus:border-amber-500 outline-none"
          />
        </div>

        <button
          disabled={loading}
          className="w-full touch-btn rounded-xl bg-amber-500 text-zinc-950 font-bold py-3 inline-flex items-center justify-center gap-2 hover:bg-amber-400 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          Abrir Caixa
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="w-full text-xs text-zinc-500 hover:text-zinc-300"
        >
          Sair
        </button>
      </form>
    </div>
  );
}

/* --------------------------- PDV PRINCIPAL ------------------------- */

function PDVMain({
  operador,
  password,
  caixaId,
  onClose,
  onLogout,
}: {
  operador: Operador;
  password: string;
  caixaId: string;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [forma, setForma] = useState<Forma>("dinheiro");

  const [cupomCode, setCupomCode] = useState("");
  const [cupomDesc, setCupomDesc] = useState<{ codigo: string; tipo: string; valor: number } | null>(null);

  const [showSangria, setShowSangria] = useState(false);
  const [showFechar, setShowFechar] = useState(false);
  const [showDevolucao, setShowDevolucao] = useState(false);
  const [saleLoading, setSaleLoading] = useState(false);

  // Load products
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("products")
        .select("id,name,price,codigo_barras,available,image")
        .eq("organization_id", operador.organization_id)
        .eq("available", true)
        .order("name");
      setProducts((data as Product[]) || []);
    })();
  }, [operador.organization_id]);

  // Focus search
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Global barcode listener
  useEffect(() => {
    let buffer = "";
    let timer: any;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Enter") {
        if (buffer.length >= 6) {
          tryAddByCode(buffer);
        }
        buffer = "";
        return;
      }
      if (/^[a-zA-Z0-9]$/.test(e.key)) {
        buffer += e.key;
        clearTimeout(timer);
        timer = setTimeout(() => (buffer = ""), 300);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  const tryAddByCode = (code: string) => {
    const p = products.find((x) => (x.codigo_barras || "").trim() === code.trim());
    if (p) {
      addToCart(p);
      beep();
      toast.success(`🛒 ${p.name} adicionado`);
    }
  };

  const beep = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 1200;
      g.gain.setValueAtTime(0.1, ctx.currentTime);
      o.start();
      o.stop(ctx.currentTime + 0.08);
    } catch {}
  };

  const addToCart = (p: Product) => {
    setCart((prev) => {
      const i = prev.findIndex((x) => x.product_id === p.id);
      if (i >= 0) {
        const c = [...prev];
        c[i] = { ...c[i], quantity: c[i].quantity + 1 };
        return c;
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          product_id: p.id,
          name: p.name,
          price: Number(p.price),
          quantity: 1,
        },
      ];
    });
  };

  const changeQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((x) => (x.id === id ? { ...x, quantity: x.quantity + delta } : x))
        .filter((x) => x.quantity > 0),
    );
  };

  const removeItem = (id: string) => setCart((prev) => prev.filter((x) => x.id !== id));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 24);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.codigo_barras || "").toLowerCase().includes(q),
      )
      .slice(0, 48);
  }, [products, query]);

  const subtotal = cart.reduce((s, x) => s + x.price * x.quantity, 0);
  const desconto = useMemo(() => {
    if (!cupomDesc) return 0;
    if (cupomDesc.tipo === "percentual" || cupomDesc.tipo === "percent")
      return Math.min(subtotal, (subtotal * Number(cupomDesc.valor)) / 100);
    return Math.min(subtotal, Number(cupomDesc.valor));
  }, [cupomDesc, subtotal]);
  const total = Math.max(0, subtotal - desconto);

  const aplicarCupom = async () => {
    const c = cupomCode.trim().toUpperCase();
    if (!c) return;
    const { data } = await supabase
      .from("cupons")
      .select("codigo,tipo,valor,status,data_inicio,data_fim")
      .eq("organization_id", operador.organization_id)
      .ilike("codigo", c)
      .maybeSingle();
    if (!data) return toast.error("Cupom não encontrado");
    if ((data as any).status && (data as any).status !== "ativo")
      return toast.error("Cupom inativo");
    const now = new Date();
    if ((data as any).data_inicio && new Date((data as any).data_inicio) > now)
      return toast.error("Cupom ainda não iniciou");
    if ((data as any).data_fim && new Date((data as any).data_fim) < now)
      return toast.error("Cupom expirado");
    setCupomDesc({
      codigo: (data as any).codigo,
      tipo: (data as any).tipo,
      valor: Number((data as any).valor) || 0,
    });
    toast.success(`Cupom ${(data as any).codigo} aplicado`);
  };

  // ---- Espelhamento p/ tela do cliente ----
  const bcRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    try { bcRef.current = new BroadcastChannel("pdv-cliente"); } catch {}
    return () => { bcRef.current?.close(); };
  }, []);
  useEffect(() => {
    const payload = {
      storeName: operador.org_name,
      items: cart,
      subtotal,
      desconto,
      total,
      forma,
    };
    try {
      localStorage.setItem("pdv_cliente_mirror_v1", JSON.stringify(payload));
      bcRef.current?.postMessage({ type: "update", payload });
    } catch {}
  }, [cart, subtotal, desconto, total, forma, operador.org_name]);

  // ---- Recibo p/ impressão ----
  const [lastReceipt, setLastReceipt] = useState<null | {
    orderNumber: string;
    createdAt: string;
    items: CartItem[];
    subtotal: number;
    desconto: number;
    total: number;
    forma: string;
    cupom: string;
  }>(null);

  const triggerPrint = () => {
    document.body.classList.add("printing-cupom");
    setTimeout(() => {
      window.print();
      setTimeout(() => document.body.classList.remove("printing-cupom"), 300);
    }, 80);
  };

  const finalizar = async () => {
    if (cart.length === 0) return toast.error("Carrinho vazio");
    setSaleLoading(true);
    const items = cart.map((x) => ({
      id: x.product_id,
      product_id: x.product_id,
      name: x.name,
      price: x.price,
      quantity: x.quantity,
    }));
    const snapshot = [...cart];
    const snapSubtotal = subtotal;
    const snapDesconto = desconto;
    const snapTotal = total;
    const snapForma = forma;
    const snapCupom = cupomDesc?.codigo || "";
    const { data, error } = await supabase.rpc("pdv_registrar_venda", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
      _items: items,
      _forma: forma,
      _total: total,
      _cupom_code: snapCupom,
      _desconto: desconto,
    });
    setSaleLoading(false);
    if (error) return toast.error(error.message);
    const res = data as any;
    if (!res?.ok) return toast.error("Falha ao registrar venda");
    toast.success(`Venda registrada — ${fmt(snapTotal)}`);
    beep();

    setLastReceipt({
      orderNumber: res.order_number,
      createdAt: res.created_at || new Date().toISOString(),
      items: snapshot,
      subtotal: snapSubtotal,
      desconto: snapDesconto,
      total: snapTotal,
      forma: snapForma,
      cupom: snapCupom,
    });
    // dispara impressão após render do recibo
    setTimeout(triggerPrint, 60);

    setCart([]);
    setCupomDesc(null);
    setCupomCode("");
    setForma("dinheiro");
    searchRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="px-4 py-3 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3 sticky top-0 bg-zinc-950/95 backdrop-blur z-20">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
            <Receipt className="w-5 h-5 text-amber-500" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white truncate">{operador.org_name}</div>
            <div className="text-xs text-zinc-400 truncate">
              PDV • Operador: <span className="text-amber-400 font-semibold">{operador.name}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setShowSangria(true)}
            className="touch-btn flex-1 sm:flex-none justify-center px-3 py-2 rounded-lg text-xs font-semibold bg-zinc-900 border border-zinc-800 text-zinc-200 hover:text-amber-400 hover:border-amber-500/30 inline-flex items-center gap-1.5"
          >
            <Banknote className="w-4 h-4" /> Sangria / Suprimento
          </button>
          <button
            onClick={() => setShowDevolucao(true)}
            className="touch-btn flex-1 sm:flex-none justify-center px-3 py-2 rounded-lg text-xs font-semibold bg-zinc-900 border border-zinc-800 text-zinc-200 hover:text-amber-400 hover:border-amber-500/30 inline-flex items-center gap-1.5"
          >
            <RotateCcw className="w-4 h-4" /> Devoluções
          </button>
          <button
            onClick={() => setShowFechar(true)}
            className="touch-btn flex-1 sm:flex-none justify-center px-3 py-2 rounded-lg text-xs font-semibold bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 inline-flex items-center gap-1.5"
          >
            <LogOut className="w-4 h-4" /> Fechar Caixa
          </button>
        </div>
      </header>


      {/* Main */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4 p-4">
        {/* Produtos */}
        <div className="space-y-3 min-w-0">
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
            <Search className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (/^\d{6,}$/.test(query.trim())) {
                    tryAddByCode(query.trim());
                    setQuery("");
                    return;
                  }
                  const first = filtered[0];
                  if (first) {
                    addToCart(first);
                    setQuery("");
                  }
                }
              }}
              placeholder="Buscar produto ou bipar código de barras…"
              className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-zinc-500"
              style={{ filter: "none", mixBlendMode: "normal" }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="text-left bg-zinc-900 border border-zinc-800 hover:border-amber-500/40 rounded-xl p-3 transition-colors"
              >
                <div className="text-sm font-semibold text-white line-clamp-2 min-h-[2.5rem]">
                  {p.name}
                </div>
                <div className="text-amber-400 font-bold mt-1">{fmt(Number(p.price))}</div>
                {p.codigo_barras && (
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">
                    {p.codigo_barras}
                  </div>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full text-center text-zinc-500 text-sm py-8">
                Nenhum produto encontrado.
              </div>
            )}
          </div>
        </div>

        {/* Carrinho */}
        <aside className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col h-fit lg:sticky lg:top-20 max-h-[calc(100vh-7rem)]">
          <div className="font-bold text-white mb-3">Comanda atual</div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {cart.length === 0 && (
              <div className="text-center text-zinc-500 text-sm py-10">
                Nenhum item. Adicione um produto ou bipe o código.
              </div>
            )}
            {cart.map((it) => (
              <div
                key={it.id}
                className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 flex items-center gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{it.name}</div>
                  <div className="text-xs text-zinc-400">
                    {fmt(it.price)} × {it.quantity} ={" "}
                    <span className="text-amber-400 font-semibold">
                      {fmt(it.price * it.quantity)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => changeQty(it.id, -1)}
                  className="w-7 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 inline-flex items-center justify-center"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <div className="w-6 text-center text-sm font-bold">{it.quantity}</div>
                <button
                  onClick={() => changeQty(it.id, 1)}
                  className="w-7 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 inline-flex items-center justify-center"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => removeItem(it.id)}
                  className="w-7 h-7 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 inline-flex items-center justify-center"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Cupom */}
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2">
              <Ticket className="w-4 h-4 text-amber-500" />
              <input
                value={cupomCode}
                onChange={(e) => setCupomCode(e.target.value.toUpperCase())}
                placeholder="Código do cupom"
                className="flex-1 bg-transparent outline-none text-sm"
              />
            </div>
            <button
              onClick={aplicarCupom}
              className="touch-btn px-3 py-2 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700"
            >
              Aplicar
            </button>
          </div>

          {/* Forma de pagamento */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["dinheiro", "pix", "cartao"] as Forma[]).map((f) => (
              <button
                key={f}
                onClick={() => setForma(f)}
                className={`py-2 rounded-lg text-xs font-bold uppercase transition-colors border ${
                  forma === f
                    ? "bg-amber-500 text-zinc-950 border-amber-500"
                    : "bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-amber-500/30"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Totais */}
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between text-zinc-400">
              <span>Subtotal</span>
              <span>{fmt(subtotal)}</span>
            </div>
            {desconto > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Desconto ({cupomDesc?.codigo})</span>
                <span>- {fmt(desconto)}</span>
              </div>
            )}
            <div className="flex justify-between text-white font-bold text-lg pt-2 border-t border-zinc-800 mt-1">
              <span>Total</span>
              <span className="text-amber-400">{fmt(total)}</span>
            </div>
          </div>

          <button
            disabled={saleLoading || cart.length === 0}
            onClick={finalizar}
            className="mt-3 touch-btn w-full py-3 rounded-xl bg-amber-500 text-zinc-950 font-bold hover:bg-amber-400 disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {saleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
            Finalizar venda
          </button>
        </aside>
      </div>

      {showSangria && (
        <SangriaModal
          operador={operador}
          password={password}
          caixaId={caixaId}
          onClose={() => setShowSangria(false)}
        />
      )}
      {showDevolucao && (
        <DevolucaoModal
          operador={operador}
          password={password}
          caixaId={caixaId}
          onClose={() => setShowDevolucao(false)}
        />
      )}
      {showFechar && (
        <FechamentoModal
          operador={operador}
          password={password}
          caixaId={caixaId}
          onClose={() => setShowFechar(false)}
          onClosed={() => {
            setShowFechar(false);
            onClose();
            onLogout();
          }}
        />
      )}

      {/* Cupom oculto p/ impressão térmica */}
      {lastReceipt && (
        <div id="print-receipt-area" className="print-receipt print-cupom">
          <div className="pr-header">
            <h1>VisionFood</h1>
            <p>{operador.org_name}</p>
            <p>
              {new Date(lastReceipt.createdAt).toLocaleDateString("pt-BR")}{" "}
              {new Date(lastReceipt.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="pr-order-num">PEDIDO #{lastReceipt.orderNumber}</p>
            <p>Operador: {operador.name}</p>
          </div>
          <div className="pr-divider" />
          <div className="pr-section">
            <p className="pr-section-title">ITENS</p>
            {lastReceipt.items.map((it, i) => (
              <div key={i} className="pr-item">
                <div className="pr-item-row">
                  <span>{it.quantity}x {it.name}</span>
                  <span>{fmt(it.price * it.quantity)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="pr-divider" />
          <div className="pr-section pr-totals">
            <div className="pr-item-row"><span>Subtotal</span><span>{fmt(lastReceipt.subtotal)}</span></div>
            {lastReceipt.desconto > 0 && (
              <div className="pr-item-row"><span>Desconto {lastReceipt.cupom && `(${lastReceipt.cupom})`}</span><span>- {fmt(lastReceipt.desconto)}</span></div>
            )}
            <div className="pr-item-row pr-total"><span>TOTAL</span><span>{fmt(lastReceipt.total)}</span></div>
            <p className="pr-payment"><strong>Pagamento:</strong> {lastReceipt.forma.toUpperCase()}</p>
          </div>
          <div className="pr-divider" />
          <p className="pr-footer">Obrigado pela preferência!</p>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- MODAIS ----------------------------- */

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SangriaModal({
  operador,
  password,
  caixaId,
  onClose,
}: {
  operador: Operador;
  password: string;
  caixaId: string;
  onClose: () => void;
}) {
  const [tipo, setTipo] = useState<"sangria" | "suprimento">("sangria");
  const [valor, setValor] = useState("0,00");
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const v = parseFloat(valor.replace(/\./g, "").replace(",", ".")) || 0;
    if (v <= 0) return toast.error("Informe um valor válido");
    if (motivo.trim().length < 3) return toast.error("Informe um motivo");
    setLoading(true);
    const { data, error } = await supabase.rpc("pdv_registrar_movimento", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
      _tipo: tipo,
      _forma: "dinheiro",
      _valor: v,
      _motivo: motivo.trim(),
    });
    setLoading(false);
    if (error || !(data as any)?.ok) return toast.error("Falha ao registrar");
    toast.success(tipo === "sangria" ? "Sangria registrada" : "Suprimento registrado");
    onClose();
  };

  return (
    <ModalShell title="Sangria / Suprimento" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setTipo("sangria")}
          className={`py-3 rounded-lg text-sm font-bold inline-flex items-center justify-center gap-2 border ${
            tipo === "sangria"
              ? "bg-red-500/15 text-red-300 border-red-500/40"
              : "bg-zinc-950 text-zinc-300 border-zinc-800"
          }`}
        >
          <ArrowDownCircle className="w-4 h-4" /> Sangria (retirada)
        </button>
        <button
          onClick={() => setTipo("suprimento")}
          className={`py-3 rounded-lg text-sm font-bold inline-flex items-center justify-center gap-2 border ${
            tipo === "suprimento"
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
              : "bg-zinc-950 text-zinc-300 border-zinc-800"
          }`}
        >
          <ArrowUpCircle className="w-4 h-4" /> Suprimento
        </button>
      </div>
      <div>
        <label className="text-xs text-zinc-400 font-semibold">Valor</label>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode="decimal"
          className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-xl font-bold text-white text-right focus:border-amber-500 outline-none"
        />
      </div>
      <div>
        <label className="text-xs text-zinc-400 font-semibold">Motivo</label>
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 outline-none"
        />
      </div>
      <button
        disabled={loading}
        onClick={submit}
        className="w-full touch-btn rounded-xl bg-amber-500 text-zinc-950 font-bold py-3 hover:bg-amber-400 disabled:opacity-60"
      >
        {loading ? "Registrando..." : "Confirmar"}
      </button>
    </ModalShell>
  );
}

function DevolucaoModal({
  operador,
  password,
  caixaId,
  onClose,
}: {
  operador: Operador;
  password: string;
  caixaId: string;
  onClose: () => void;
}) {
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<any | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);

  const buscar = async () => {
    if (!orderId.trim()) return;
    setLoading(true);
    let q = supabase
      .from("orders")
      .select("id,items,total,status,customer_name,created_at,organization_id")
      .eq("organization_id", operador.organization_id)
      .limit(1);
    // Permitir buscar por uuid completo OU pelos primeiros caracteres
    if (orderId.includes("-") && orderId.length >= 30) {
      q = q.eq("id", orderId.trim());
    } else {
      q = q.ilike("id", `${orderId.trim()}%`);
    }
    const { data } = await q.maybeSingle();
    setLoading(false);
    if (!data) {
      setOrder(null);
      setItems([]);
      return toast.error("Pedido não encontrado");
    }
    setOrder(data);
    const arr = Array.isArray(data.items) ? data.items : [];
    setItems(arr);
    setSelected({});
  };

  const toggleQty = (idx: number, delta: number, max: number) => {
    setSelected((s) => {
      const cur = s[idx] || 0;
      const next = Math.max(0, Math.min(max, cur + delta));
      return { ...s, [idx]: next };
    });
  };

  const valorTotal = useMemo(() => {
    return items.reduce((sum, it, idx) => {
      const qty = selected[idx] || 0;
      const price = Number(it.price) || 0;
      return sum + qty * price;
    }, 0);
  }, [items, selected]);

  const confirmar = async () => {
    const devolvidos = items
      .map((it, idx) => ({ ...it, quantity: selected[idx] || 0 }))
      .filter((x) => x.quantity > 0);
    if (devolvidos.length === 0) return toast.error("Selecione ao menos 1 item");
    if (motivo.trim().length < 3) return toast.error("Informe o motivo");
    setLoading(true);
    const { data, error } = await supabase.rpc("pdv_devolver_pedido", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
      _order_id: order.id,
      _items_devolvidos: devolvidos,
      _valor_devolucao: valorTotal,
      _motivo: motivo.trim(),
    });
    setLoading(false);
    if (error || !(data as any)?.ok) return toast.error("Falha ao processar devolução");
    toast.success(`Devolução de ${fmt(valorTotal)} registrada`);
    onClose();
  };

  return (
    <ModalShell title="Devolução de pedido" onClose={onClose}>
      <div className="flex items-center gap-2">
        <input
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          placeholder="Número/ID do pedido"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 outline-none"
        />
        <button
          onClick={buscar}
          disabled={loading}
          className="touch-btn px-4 py-2 rounded-lg bg-amber-500 text-zinc-950 font-bold text-sm hover:bg-amber-400"
        >
          Buscar
        </button>
      </div>

      {order && (
        <div className="space-y-2">
          <div className="text-xs text-zinc-400">
            Pedido {order.id.slice(0, 8)} • {order.customer_name || "-"} •{" "}
            <b className="text-amber-400">{fmt(Number(order.total))}</b>
          </div>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {items.map((it: any, idx) => {
              const max = Number(it.quantity) || 1;
              const cur = selected[idx] || 0;
              return (
                <div
                  key={idx}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 flex items-center gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{it.name}</div>
                    <div className="text-xs text-zinc-500">
                      {fmt(Number(it.price))} × até {max}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleQty(idx, -1, max)}
                    className="w-7 h-7 rounded-md bg-zinc-800"
                  >
                    <Minus className="w-3.5 h-3.5 mx-auto" />
                  </button>
                  <div className="w-6 text-center text-sm font-bold">{cur}</div>
                  <button
                    onClick={() => toggleQty(idx, 1, max)}
                    className="w-7 h-7 rounded-md bg-zinc-800"
                  >
                    <Plus className="w-3.5 h-3.5 mx-auto" />
                  </button>
                </div>
              );
            })}
          </div>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Motivo da devolução"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 outline-none"
          />
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Valor a estornar (dinheiro):</span>
            <b className="text-amber-400">{fmt(valorTotal)}</b>
          </div>
          <button
            disabled={loading}
            onClick={confirmar}
            className="w-full touch-btn rounded-xl bg-amber-500 text-zinc-950 font-bold py-3 hover:bg-amber-400 disabled:opacity-60"
          >
            Confirmar devolução
          </button>
        </div>
      )}
    </ModalShell>
  );
}

function FechamentoModal({
  operador,
  password,
  caixaId,
  onClose,
  onClosed,
}: {
  operador: Operador;
  password: string;
  caixaId: string;
  onClose: () => void;
  onClosed: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [resumo, setResumo] = useState<any | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Pré-visualização (carrega resumo parcial via movimentos)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("caixa_movimentos")
        .select("tipo,forma_pagamento,valor")
        .eq("caixa_id", caixaId);
      if (!data) return;
      const sum = (cond: (r: any) => boolean) =>
        data.filter(cond).reduce((s, r: any) => s + Number(r.valor), 0);
      const inicial = sum((r) => r.tipo === "abertura");
      const vDin = sum((r) => r.tipo === "venda" && r.forma_pagamento === "dinheiro");
      const vPix = sum((r) => r.tipo === "venda" && r.forma_pagamento === "pix");
      const vCart = sum((r) => r.tipo === "venda" && r.forma_pagamento === "cartao");
      const sangria = sum((r) => r.tipo === "sangria");
      const suprimento = sum((r) => r.tipo === "suprimento");
      const devolucao = sum((r) => r.tipo === "devolucao");
      setResumo({
        saldo_inicial: inicial,
        vendas_dinheiro: vDin,
        vendas_pix: vPix,
        vendas_cartao: vCart,
        total_vendas: vDin + vPix + vCart,
        sangrias: sangria,
        suprimentos: suprimento,
        devolucoes: devolucao,
        saldo_final_dinheiro: inicial + vDin + suprimento - sangria - devolucao,
      });
    })();
  }, [caixaId]);

  const fechar = async () => {
    setConfirming(true);
    const { data, error } = await supabase.rpc("pdv_fechar_caixa", {
      _operador_id: operador.id,
      _password: password,
      _caixa_id: caixaId,
    });
    setConfirming(false);
    if (error || !(data as any)?.ok) return toast.error("Falha ao fechar caixa");
    toast.success("Caixa fechado");
    onClosed();
  };

  const row = (label: string, value: number, accent = false) => (
    <div className="flex justify-between text-sm py-1">
      <span className="text-zinc-400">{label}</span>
      <span className={accent ? "text-amber-400 font-bold" : "text-white"}>{fmt(value)}</span>
    </div>
  );

  return (
    <ModalShell title="Fechamento de Caixa" onClose={onClose}>
      {!resumo ? (
        <div className="text-center text-zinc-500 py-6">Carregando resumo…</div>
      ) : (
        <div className="space-y-1">
          {row("Saldo inicial", resumo.saldo_inicial)}
          <div className="border-t border-zinc-800 my-2" />
          {row("Vendas Dinheiro", resumo.vendas_dinheiro)}
          {row("Vendas Pix", resumo.vendas_pix)}
          {row("Vendas Cartão", resumo.vendas_cartao)}
          {row("Total vendas", resumo.total_vendas, true)}
          <div className="border-t border-zinc-800 my-2" />
          {row("Suprimentos", resumo.suprimentos)}
          {row("Sangrias", -resumo.sangrias)}
          {row("Devoluções", -resumo.devolucoes)}
          <div className="border-t border-zinc-800 my-2" />
          {row("Saldo final em dinheiro", resumo.saldo_final_dinheiro, true)}

          <button
            disabled={confirming}
            onClick={fechar}
            className="mt-4 w-full touch-btn rounded-xl bg-red-500 text-white font-bold py-3 hover:bg-red-600 disabled:opacity-60"
          >
            {confirming ? "Fechando..." : "Fechar caixa agora"}
          </button>
        </div>
      )}
    </ModalShell>
  );
}
