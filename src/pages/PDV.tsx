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
  MessageCircle,
  QrCode,
  CreditCard,
} from "lucide-react";
import { BRAND_NAME } from "@/config/brandConfig";
import { createPdvSession, validatePdvSession, revokePdvSession, savePdvSession, readPdvSession, clearPdvSession, pdvRpc } from "@/lib/pdvSession";

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


export default function PDV() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [operador, setOperador] = useState<Operador | null>(null);
  const [sessionToken, setSessionToken] = useState<string>("");
  const [caixaId, setCaixaId] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  // Restore only an opaque server-issued session token; discard legacy password persistence.
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
        onLogin={(op, token, openCaixa) => {
          setOperador(op);
          setSessionToken(token);
          setCaixaId(openCaixa);
        }}
      />
    );
  }

  if (!caixaId) {
    return (
      <AberturaScreen
        operador={operador}
        sessionToken={sessionToken}
        onOpen={(id) => setCaixaId(id)}
        onLogout={logout}
      />
    );
  }

  return (
    <PDVMain
      operador={operador}
      sessionToken={sessionToken}
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
  onLogin: (op: Operador, sessionToken: string, caixaAbertoId: string | null) => void;
}) {
  const [orgSlug, setOrgSlug] = useState(slug || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgSlug || !username || !password) return;
    setLoading(true);
    let res: any;
    try { res = await createPdvSession(orgSlug, username, password); }
    catch (error: any) { setLoading(false); return toast.error(error?.message || "Falha ao entrar"); }
    setLoading(false);
    if (!res?.ok) {
      toast.error(
        res?.reason === "org_not_found"
          ? "Loja não encontrada"
          : "Usuário ou senha inválidos",
      );
      return;
    }
    toast.success(`Bem-vindo, ${res.operador.name}`);
    onLogin(res.operador, res.session_token, res.caixa_aberto_id || null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 space-y-5 shadow-2xl relative"
      >
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? window.history.back() : (window.location.href = "/"))}
          className="absolute left-4 top-4 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-amber-400 transition-colors"
          aria-label="Voltar"
        >
          ← Voltar
        </button>
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
  sessionToken,
  onOpen,
  onLogout,
}: {
  operador: Operador;
  sessionToken: string;
  onOpen: (caixaId: string) => void;
  onLogout: () => void;
}) {
  const [valor, setValor] = useState<string>("0,00");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = parseFloat(valor.replace(/\./g, "").replace(",", ".")) || 0;
    setLoading(true);
    const { data, error } = await pdvRpc.openCash(sessionToken, v);
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
  sessionToken,
  caixaId,
  onClose,
  onLogout,
}: {
  operador: Operador;
  sessionToken: string;
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
  const [customerPhone, setCustomerPhone] = useState("");

  const [showSangria, setShowSangria] = useState(false);
  const [showFechar, setShowFechar] = useState(false);
  const [showDevolucao, setShowDevolucao] = useState(false);
  const [saleLoading, setSaleLoading] = useState(false);

  // Load products
  useEffect(() => {
    (async () => {
      const { data, error } = await pdvRpc.catalog(sessionToken);
      const res = data as any;
      if (error || !res?.ok) {
        console.error("[PDV] secure catalog load failed", error || res?.reason);
        setProducts([]);
        toast.error("Não foi possível carregar os produtos do PDV");
        return;
      }
      setProducts((res.products as Product[]) || []);
    })();
  }, [sessionToken]);

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
    const { data, error } = await pdvRpc.validateCoupon(sessionToken, c);
    const res = data as any;
    if (error) return toast.error(error.message);
    if (!res?.ok) {
      const messages: Record<string, string> = {
        not_found: "Cupom não encontrado",
        inactive: "Cupom inativo",
        not_started: "Cupom ainda não iniciou",
        expired: "Cupom expirado",
        invalid_session: "Sessão do PDV expirada",
      };
      return toast.error(messages[res?.reason] || "Cupom inválido");
    }
    const cupom = res.cupom as any;
    setCupomDesc({
      codigo: cupom.codigo,
      tipo: cupom.tipo,
      valor: Number(cupom.valor) || 0,
    });
    toast.success(`Cupom ${cupom.codigo} aplicado`);
  };

  // ---- Espelhamento p/ tela do cliente ----
  const bcRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    try { bcRef.current = new BroadcastChannel("pdv-cliente"); } catch {}
    return () => { bcRef.current?.close(); };
  }, []);

  // 🟢 Gera Pix real (Mercado Pago) quando o operador escolhe PIX no PDV.
  // O QR + Copia-e-Cola viaja no broadcast e aparece GIGANTE na tela do cliente.
  const [pixData, setPixData] = useState<{ qrBase64: string; copiaECola: string; amount: number; intentId: string } | null>(null);
  const [pixLoading, setPixLoading] = useState(false);
  const pixReqId = useRef(0);
  useEffect(() => {
    // Limpa Pix quando o operador troca de forma ou zera carrinho
    if (forma !== "pix" || total <= 0) {
      setPixData(null);
      setPixLoading(false);
      return;
    }
    // Reutiliza o QR se o valor não mudou
    if (pixData && Math.abs(pixData.amount - total) < 0.005) return;

    const myReq = ++pixReqId.current;
    setPixLoading(true);
    const t = setTimeout(async () => {
      try {
        const pixItems = cart.map((x) => ({ product_id: x.product_id, quantity: x.quantity }));
        const { data: intentData, error: intentError } = await pdvRpc.createPixIntent(
          sessionToken,
          caixaId,
          pixItems,
          cupomDesc?.codigo || "",
        );
        const intent = intentData as any;
        if (myReq !== pixReqId.current) return;
        if (intentError || !intent?.ok || !intent?.intent_id) {
          setPixData(null);
          return;
        }
        const { data, error } = await supabase.functions.invoke("mercadopago-create-pix", {
          body: { intent_id: intent.intent_id, session_token: sessionToken },
        });
        if (myReq !== pixReqId.current) return; // resposta atrasada — ignora
        if (error || !(data as any)?.ok) {
          setPixData(null);
          return;
        }
        const d = data as any;
        setPixData({
          qrBase64: d.qr_code_base64 || "",
          copiaECola: d.qr_code || "",
          amount: Number(d.amount ?? intent.amount) || 0,
          intentId: String(d.intent_id || intent.intent_id),
        });
      } finally {
        if (myReq === pixReqId.current) setPixLoading(false);
      }
    }, 350); // pequeno debounce p/ não disparar a cada centavo
    return () => clearTimeout(t);
  }, [forma, total, cart, cupomDesc?.codigo, sessionToken, caixaId, pixData]);

  useEffect(() => {
    const payload = {
      storeName: operador.org_name,
      items: cart,
      subtotal,
      desconto,
      total,
      forma,
      pixQrBase64: pixData?.qrBase64 || "",
      pixCopiaECola: pixData?.copiaECola || "",
      pixLoading,
    };
    try {
      localStorage.setItem("pdv_cliente_mirror_v1", JSON.stringify(payload));
      bcRef.current?.postMessage({ type: "update", payload });
    } catch {}
  }, [cart, subtotal, desconto, total, forma, operador.org_name, pixData, pixLoading]);

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
    if (forma === "pix") {
      if (!pixData?.intentId) return toast.error("Gere o PIX antes de finalizar");
      const { data: pixStatusData, error: pixStatusError } = await pdvRpc.pixStatus(sessionToken, pixData.intentId);
      const pixStatus = pixStatusData as any;
      if (pixStatusError || !pixStatus?.ok || !["paid", "approved"].includes(String(pixStatus.status || "").toLowerCase())) {
        return toast.error("Pagamento PIX ainda não confirmado");
      }
    }
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
    const saleResult = forma === "pix" && pixData?.intentId
    ? await pdvRpc.pixSale(sessionToken, pixData.intentId)
    : await pdvRpc.sale(sessionToken, caixaId, items, forma, total, snapCupom, desconto);
  const { data, error } = saleResult;
    setSaleLoading(false);
    if (error) return toast.error(error.message);
    const res = data as any;
    if (!res?.ok) return toast.error("Falha ao registrar venda");
    const canonicalSubtotal = Number(res.subtotal ?? snapSubtotal);
    const canonicalDesconto = Number(res.desconto ?? snapDesconto);
    const canonicalTotal = Number(res.total ?? snapTotal);
    const canonicalItems = Array.isArray(res.items)
      ? res.items.map((x: any) => ({
          id: String(x.product_id),
          product_id: String(x.product_id),
          name: String(x.name || "Produto"),
          price: Number(x.price) || 0,
          quantity: Number(x.quantity) || 0,
        }))
      : snapshot;
    toast.success(`Venda registrada — ${fmt(canonicalTotal)}`);
    beep();

    // 📱 Persiste telefone do cliente no pedido + dispara WhatsApp automático
    const phoneDigits = customerPhone.replace(/\D/g, "");
    if (phoneDigits.length >= 10 && res.order_id) {
      try {
        // garante DDI 55 (Brasil) quando o operador digita só DDD+número
        const waNumber = phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`;

        const { data: phoneData, error: phoneError } = await pdvRpc.setOrderCustomerPhone(
          sessionToken,
          res.order_id,
          phoneDigits,
        );
        const phoneRes = phoneData as any;
        if (phoneError || !phoneRes?.ok) {
          console.error("[PDV] secure customer phone update failed", phoneError || phoneRes?.reason);
          toast.error("Venda concluída, mas não foi possível salvar o telefone do cliente");
        }

        const trackUrl = `${window.location.origin}/acompanhar/${res.order_id}`;
        const msg =
          `Olá! Seu pedido na ${BRAND_NAME} já foi recebido e já está em preparo na cozinha! 🍳 ` +
          `Confira seu cupom fiscal digital e acompanhe o status em tempo real por este link: ${trackUrl}`;
        const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}`;
        window.open(waUrl, "_blank", "noopener,noreferrer");
        toast.success("WhatsApp aberto para envio ao cliente 📲");
      } catch (e) {
        console.error("[PDV] whatsapp dispatch", e);
      }
    }

    setLastReceipt({
      orderNumber: res.order_number,
      createdAt: res.created_at || new Date().toISOString(),
      items: canonicalItems,
      subtotal: canonicalSubtotal,
      desconto: canonicalDesconto,
      total: canonicalTotal,
      forma: snapForma,
      cupom: snapCupom,
    });
    // dispara impressão após render do recibo
    setTimeout(triggerPrint, 60);

    setCart([]);
    setCupomDesc(null);
    setCupomCode("");
    setCustomerPhone("");
    setForma("dinheiro");
    searchRef.current?.focus();
  };

  return (
    <div className="min-h-screen text-zinc-100 flex flex-col">
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
            onClick={() => window.open("/pdv-cliente", "pdv-cliente", "width=900,height=700")}
            className="touch-btn flex-1 sm:flex-none justify-center px-3 py-2 rounded-lg text-xs font-semibold bg-zinc-900 border border-zinc-800 text-zinc-200 hover:text-amber-400 hover:border-amber-500/30 inline-flex items-center gap-1.5"
          >
            <Receipt className="w-4 h-4" /> Tela Cliente
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
            {cart.map((it, idx) => (
              <div
                key={it.id}
                className={`flex items-center gap-2 py-3 ${idx > 0 ? "border-t border-zinc-800/70" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-semibold truncate">{it.name}</div>
                  <div className="text-xs text-zinc-500">
                    {fmt(it.price)} × {it.quantity} ={" "}
                    <span className="text-amber-400 font-bold tabular-nums">
                      {fmt(it.price * it.quantity)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => changeQty(it.id, -1)}
                  className="w-7 h-7 rounded-md bg-zinc-800/80 hover:bg-zinc-700 inline-flex items-center justify-center"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <div className="w-6 text-center text-sm font-bold">{it.quantity}</div>
                <button
                  onClick={() => changeQty(it.id, 1)}
                  className="w-7 h-7 rounded-md bg-zinc-800/80 hover:bg-zinc-700 inline-flex items-center justify-center"
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

          {/* WhatsApp do cliente — dispara mensagem automática com link de acompanhamento */}
          <div className="mt-3 flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 focus-within:border-amber-500/50">
            <MessageCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="WhatsApp do cliente (DDD + número)"
              inputMode="tel"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-zinc-500"
            />
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

          {/* Forma de pagamento — grid tátil */}
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {([
              { id: "dinheiro" as Forma, label: "Dinheiro", Icon: Banknote },
              { id: "pix" as Forma, label: "Pix", Icon: QrCode },
              { id: "cartao" as Forma, label: "Cartão", Icon: CreditCard },
            ]).map(({ id, label, Icon }) => {
              const active = forma === id;
              return (
                <button
                  key={id}
                  onClick={() => setForma(id)}
                  className={`aspect-square rounded-2xl border-2 flex flex-col items-center justify-between p-3 transition-all duration-200 ${
                    active
                      ? "bg-gradient-to-br from-amber-500/15 to-orange-600/10 border-amber-500 text-white pulse-amber-ring"
                      : "bg-zinc-950/60 border-zinc-800 text-zinc-300 hover:border-amber-500/40 hover:bg-zinc-900/60"
                  }`}
                >
                  <Icon className={`w-7 h-7 mt-1 ${active ? "text-amber-400" : "text-zinc-400"}`} strokeWidth={2} />
                  <span className="text-xs font-extrabold uppercase tracking-wider">{label}</span>
                </button>
              );
            })}
          </div>

          {/* Totais */}
          <div className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between text-zinc-400">
              <span>Subtotal</span>
              <span className="tabular-nums">{fmt(subtotal)}</span>
            </div>
            {desconto > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Desconto ({cupomDesc?.codigo})</span>
                <span className="tabular-nums">- {fmt(desconto)}</span>
              </div>
            )}
            <div className="flex justify-between items-end pt-2 border-t border-zinc-800 mt-1">
              <span className="text-zinc-400">Total</span>
              <span className="text-amber-400 font-black text-2xl tabular-nums">{fmt(total)}</span>
            </div>
          </div>

          <button
            disabled={saleLoading || cart.length === 0}
            onClick={finalizar}
            className="btn-premium mt-4 w-full py-3.5 text-base"
          >
            {saleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
            Finalizar venda
          </button>
        </aside>
      </div>

      {showSangria && (
        <SangriaModal
          operador={operador}
          sessionToken={sessionToken}
          caixaId={caixaId}
          onClose={() => setShowSangria(false)}
        />
      )}
      {showDevolucao && (
        <DevolucaoModal
          operador={operador}
          sessionToken={sessionToken}
          caixaId={caixaId}
          onClose={() => setShowDevolucao(false)}
        />
      )}
      {showFechar && (
        <FechamentoModal
          operador={operador}
          sessionToken={sessionToken}
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
  sessionToken,
  caixaId,
  onClose,
}: {
  operador: Operador;
  sessionToken: string;
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
    const { data, error } = await pdvRpc.movement(sessionToken, caixaId, tipo, "dinheiro", v, motivo.trim());
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
  sessionToken,
  caixaId,
  onClose,
}: {
  operador: Operador;
  sessionToken: string;
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
    const { data, error } = await pdvRpc.findOrder(sessionToken, orderId.trim());
    setLoading(false);
    const res = data as any;
    if (error || !res?.ok || !res?.order) {
      setOrder(null);
      setItems([]);
      return toast.error(res?.reason === "invalid_session" ? "Sessão expirada. Entre novamente." : "Pedido não encontrado");
    }
    const dataOrder = res.order;
    setOrder(dataOrder);
    const arr = Array.isArray(dataOrder.items) ? dataOrder.items : [];
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
    const { data, error } = await pdvRpc.refund(sessionToken, caixaId, order.id, devolvidos, valorTotal, motivo.trim());
    setLoading(false);
    const res = data as any;
    if (error || !res?.ok) return toast.error("Falha ao processar devolução");
    const canonicalRefund = Number(res.valor_devolucao) || 0;
    toast.success(`Devolução de ${fmt(canonicalRefund)} registrada`);
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
  sessionToken,
  caixaId,
  onClose,
  onClosed,
}: {
  operador: Operador;
  sessionToken: string;
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
      const { data, error } = await pdvRpc.cashSummary(sessionToken, caixaId);
      const res = data as any;
      if (error || !res?.ok || !res?.resumo) {
        toast.error(res?.reason === "invalid_session" ? "Sessão expirada. Entre novamente." : "Falha ao carregar resumo do caixa");
        return;
      }
      setResumo(res.resumo);
    })();
  }, [caixaId, sessionToken]);

  const fechar = async () => {
    setConfirming(true);
    const { data, error } = await pdvRpc.closeCash(sessionToken, caixaId);
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
