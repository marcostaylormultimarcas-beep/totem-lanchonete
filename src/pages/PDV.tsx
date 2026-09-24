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

const PDV_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PdvPixIntentSuccess = {
  intent_id: string;
  amount: number;
};

function parsePdvPixIntentSuccess(value: unknown): PdvPixIntentSuccess | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const payload = value as Record<string, unknown>;
  if (payload.ok !== true) return null;

  const intentId =
    typeof payload.intent_id === "string" ? payload.intent_id.trim() : "";
  const amount =
    typeof payload.amount === "number" ? payload.amount : Number.NaN;

  if (
    !PDV_UUID_PATTERN.test(intentId) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(Math.round(amount * 100))
  ) {
    return null;
  }

  return {
    intent_id: intentId,
    amount,
  };
}

type PdvCreatePixSuccess = {
  intent_id: string;
  payment_id: string;
  status: string;
  amount: number;
  qr_code_base64: string;
  qr_code: string;
  ticket_url: string;
};

function parsePdvCreatePixSuccess(
  value: unknown,
  expectedIntent: PdvPixIntentSuccess,
): PdvCreatePixSuccess | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const payload = value as Record<string, unknown>;
  if (payload.ok !== true) return null;

  const intentId =
    typeof payload.intent_id === "string" ? payload.intent_id.trim() : "";
  if (intentId !== expectedIntent.intent_id) return null;

  let paymentId = "";
  if (typeof payload.payment_id === "string") {
    paymentId = payload.payment_id.trim();
  } else if (
    typeof payload.payment_id === "number" &&
    Number.isFinite(payload.payment_id) &&
    payload.payment_id > 0 &&
    Number.isSafeInteger(payload.payment_id)
  ) {
    paymentId = String(payload.payment_id);
  }
  if (!paymentId) return null;

  const status =
    typeof payload.status === "string" ? payload.status.trim() : "";
  if (!status) return null;

  const amount =
    typeof payload.amount === "number" ? payload.amount : Number.NaN;
  const amountCents = Math.round(amount * 100);
  const expectedAmountCents = Math.round(expectedIntent.amount * 100);
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(amountCents) ||
    amountCents !== expectedAmountCents
  ) {
    return null;
  }

  const qrBase64 =
    typeof payload.qr_code_base64 === "string"
      ? payload.qr_code_base64.trim()
      : "";
  const qrCode =
    typeof payload.qr_code === "string" ? payload.qr_code.trim() : "";
  if (!qrBase64 || !qrCode) return null;

  if (typeof payload.ticket_url !== "string") return null;

  return {
    intent_id: intentId,
    payment_id: paymentId,
    status,
    amount,
    qr_code_base64: qrBase64,
    qr_code: qrCode,
    ticket_url: payload.ticket_url.trim(),
  };
}

type PdvPixStatusSuccess = {
  status:
    | "pending"
    | "payment_created"
    | "paid"
    | "failed"
    | "consumed"
    | "cancelled"
    | "expired";
  paid: boolean;
};

const PDV_PIX_STATUS_VALUES = new Set<PdvPixStatusSuccess["status"]>([
  "pending",
  "payment_created",
  "paid",
  "failed",
  "consumed",
  "cancelled",
  "expired",
]);

function parsePdvPixStatusSuccess(
  value: unknown,
  expectedIntentId: string,
  expectedAmount: number,
): PdvPixStatusSuccess | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const payload = value as Record<string, unknown>;
  if (payload.ok !== true) return null;

  if (
    typeof payload.intent_id !== "string" ||
    payload.intent_id !== expectedIntentId
  ) {
    return null;
  }

  if (
    typeof payload.status !== "string" ||
    !PDV_PIX_STATUS_VALUES.has(payload.status as PdvPixStatusSuccess["status"])
  ) {
    return null;
  }

  if (typeof payload.paid !== "boolean") return null;
  if (payload.paid !== (payload.status === "paid")) return null;

  const amount =
    typeof payload.amount === "number" ? payload.amount : Number.NaN;
  const amountCents = Math.round(amount * 100);
  const expectedAmountCents = Math.round(expectedAmount * 100);
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(amountCents) ||
    !Number.isSafeInteger(expectedAmountCents) ||
    amountCents !== expectedAmountCents
  ) {
    return null;
  }

  if (
    payload.payment_status !== null &&
    typeof payload.payment_status !== "string"
  ) {
    return null;
  }

  if (payload.paid_at !== null && typeof payload.paid_at !== "string") {
    return null;
  }

  return {
    status: payload.status as PdvPixStatusSuccess["status"],
    paid: payload.paid,
  };
}
type PdvPixSaleItem = {
  product_id: string;
  name: string;
  price: number;
  quantity: number;
};

type PdvPixSaleSuccess = {
  idempotent: boolean;
  order_id: string;
  order_number: string;
  created_at: string;
  total: number;
  items: PdvPixSaleItem[];
};

function parsePdvPixSaleSuccess(
  value: unknown,
  expectedTotal: number,
): PdvPixSaleSuccess | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const payload = value as Record<string, unknown>;
  if (payload.ok !== true || typeof payload.idempotent !== "boolean") {
    return null;
  }

  const orderId =
    typeof payload.order_id === "string" ? payload.order_id.trim() : "";
  const orderNumber =
    typeof payload.order_number === "string" ? payload.order_number.trim() : "";
  const createdAt =
    typeof payload.created_at === "string" ? payload.created_at.trim() : "";
  if (!PDV_UUID_PATTERN.test(orderId) || !orderNumber || !createdAt) {
    return null;
  }

  const total =
    typeof payload.total === "number" ? payload.total : Number.NaN;
  const totalCents = Math.round(total * 100);
  const expectedTotalCents = Math.round(expectedTotal * 100);
  if (
    !Number.isFinite(total) ||
    total <= 0 ||
    !Number.isSafeInteger(totalCents) ||
    !Number.isSafeInteger(expectedTotalCents) ||
    totalCents !== expectedTotalCents
  ) {
    return null;
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return null;
  }

  const items: PdvPixSaleItem[] = [];
  for (const raw of payload.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const productId =
      typeof item.product_id === "string" ? item.product_id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const price =
      typeof item.price === "number" ? item.price : Number.NaN;
    const quantity =
      typeof item.quantity === "number" ? item.quantity : Number.NaN;
    const priceCents = Math.round(price * 100);

    if (
      !PDV_UUID_PATTERN.test(productId) ||
      !name ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isSafeInteger(priceCents) ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      quantity > PDV_MAX_ITEM_QUANTITY
    ) {
      return null;
    }

    items.push({
      product_id: productId,
      name,
      price,
      quantity,
    });
  }

  return {
    idempotent: payload.idempotent,
    order_id: orderId,
    order_number: orderNumber,
    created_at: createdAt,
    total,
    items,
  };
}

type PdvNonPixSaleSuccess = {
  order_id: string;
  order_number: string;
  created_at: string;
  subtotal: number;
  desconto: number;
  total: number;
  items: PdvPixSaleItem[];
};

function parsePdvNonPixSaleSuccess(
  value: unknown,
): PdvNonPixSaleSuccess | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const payload = value as Record<string, unknown>;
  if (payload.ok !== true) return null;

  const orderId =
    typeof payload.order_id === "string" ? payload.order_id.trim() : "";
  const orderNumber =
    typeof payload.order_number === "string" ? payload.order_number.trim() : "";
  const createdAt =
    typeof payload.created_at === "string" ? payload.created_at.trim() : "";
  if (!PDV_UUID_PATTERN.test(orderId) || !orderNumber || !createdAt) {
    return null;
  }

  const subtotalCents = pdvMoneyToSafeCents(payload.subtotal);
  const descontoCents = pdvMoneyToSafeCents(payload.desconto);
  const totalCents = pdvMoneyToSafeCents(payload.total);
  if (
    subtotalCents === null ||
    descontoCents === null ||
    totalCents === null ||
    descontoCents > subtotalCents ||
    totalCents !== subtotalCents - descontoCents
  ) {
    return null;
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return null;
  }

  const items: PdvPixSaleItem[] = [];
  for (const raw of payload.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const productId =
      typeof item.product_id === "string" ? item.product_id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const priceCents = pdvMoneyToSafeCents(item.price);
    const quantity =
      typeof item.quantity === "number" ? item.quantity : Number.NaN;

    if (
      !PDV_UUID_PATTERN.test(productId) ||
      !name ||
      priceCents === null ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      quantity > PDV_MAX_ITEM_QUANTITY
    ) {
      return null;
    }

    items.push({
      product_id: productId,
      name,
      price: priceCents / 100,
      quantity,
    });
  }

  return {
    order_id: orderId,
    order_number: orderNumber,
    created_at: createdAt,
    subtotal: subtotalCents / 100,
    desconto: descontoCents / 100,
    total: totalCents / 100,
    items,
  };
}

function pdvNonPixSaleReasonMessage(reason: unknown) {
  const messages: Record<string, string> = {
    payment_method_disabled: "Forma de pagamento indisponível.",
    invalid_coupon: "Cupom não é mais válido para esta venda. Revise o pedido.",
    coupon_minimum_not_met:
      "O pedido não atende mais ao mínimo do cupom. Revise o pedido.",
    product_not_found: "Produto indisponível. Atualize o carrinho.",
    invalid_sale: "Venda rejeitada. Revise os itens e tente novamente.",
    invalid_quantity: "Venda rejeitada. Revise os itens e tente novamente.",
    invalid_product_id: "Venda rejeitada. Revise os itens e tente novamente.",
  };

  return typeof reason === "string" && messages[reason]
    ? messages[reason]
    : "Falha ao registrar venda";
}

function pdvPixSaleReasonMessage(reason: unknown) {
  const messages: Record<string, string> = {
    invalid_pix_intent: "PIX inválido para esta sessão. Gere um novo PIX.",
    pix_not_paid: "Pagamento PIX ainda não confirmado",
    invalid_cash_register: "Caixa inválido ou fechado. Reabra o caixa.",
  };

  return typeof reason === "string" && messages[reason]
    ? messages[reason]
    : "Falha ao registrar venda PIX";
}

function pdvPixIntentReasonMessage(reason: unknown) {
  const messages: Record<string, string> = {
    invalid_cash_register: "Caixa inválido ou fechado. Reabra o caixa.",
    invalid_sale: "Carrinho inválido para gerar o PIX. Revise os itens.",
    invalid_quantity: "Carrinho inválido para gerar o PIX. Revise os itens.",
    invalid_product_id: "Carrinho inválido para gerar o PIX. Revise os itens.",
    product_not_found: "Produto indisponível para gerar o PIX. Atualize o carrinho.",
    insufficient_stock: "Estoque insuficiente para gerar o PIX.",
    insufficient_ingredient_stock:
      "Estoque de ingredientes insuficiente para gerar o PIX.",
    invalid_coupon: "Cupom inválido para este pedido.",
    coupon_minimum_not_met: "O pedido não atende ao mínimo do cupom.",
    invalid_total: "Total inválido para gerar o PIX. Revise o carrinho.",
  };

  return typeof reason === "string" && messages[reason]
    ? messages[reason]
    : "Não foi possível iniciar o PIX. Tente novamente.";
}

function parsePdvCatalogProducts(value: unknown): Product[] | null {
  if (!Array.isArray(value)) return null;

  const parsed: Product[] = [];
  const seenIds = new Set<string>();

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const price = typeof item.price === "number" ? item.price : Number.NaN;
    const priceCents = Math.round(price * 100);
    const validBarcode = item.codigo_barras === null || typeof item.codigo_barras === "string";
    const validImage = typeof item.image === "string";
    const validAvailability = item.available === true || item.available === null;

    if (
      !PDV_UUID_PATTERN.test(id) ||
      seenIds.has(id) ||
      !name ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isSafeInteger(priceCents) ||
      !validBarcode ||
      !validImage ||
      !validAvailability
    ) {
      return null;
    }

    seenIds.add(id);
    parsed.push({
      id,
      name,
      price: priceCents / 100,
      codigo_barras: item.codigo_barras as string | null,
      available: true,
      image: item.image as string,
    });
  }

  return parsed;
}

function normalizePdvSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizePdvBarcode(value: string) {
  return value.trim();
}

type CartItem = {
  id: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
};

const PDV_MAX_ITEM_QUANTITY = 999;

export function calculatePdvSubtotal(
  items: readonly { price: unknown; quantity: unknown }[],
) {
  let subtotalCents = 0;

  for (const item of items) {
    if (
      typeof item.price !== "number" ||
      !Number.isFinite(item.price) ||
      item.price < 0 ||
      typeof item.quantity !== "number" ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > PDV_MAX_ITEM_QUANTITY
    ) {
      continue;
    }

    // Accumulate in integer cents so floating-point drift cannot reach the subtotal.
    // Invalid or unsafe local rows are isolated instead of poisoning the whole sum.
    const priceCents = Math.round(item.price * 100);
    if (!Number.isSafeInteger(priceCents) || priceCents < 0) continue;

    const lineCents = priceCents * item.quantity;
    if (!Number.isSafeInteger(lineCents)) continue;

    const nextSubtotalCents = subtotalCents + lineCents;
    if (!Number.isSafeInteger(nextSubtotalCents)) continue;

    subtotalCents = nextSubtotalCents;
  }

  return subtotalCents / 100;
}

export function shouldInvalidatePdvCoupon(
  subtotal: number,
  minimumValue: unknown,
) {
  const subtotalCents = Math.round(subtotal * 100);
  if (
    !Number.isFinite(subtotal) ||
    subtotal < 0 ||
    !Number.isSafeInteger(subtotalCents)
  ) {
    return true;
  }

  if (minimumValue == null) return false;

  const normalizedMinimum =
    typeof minimumValue === "string" ? minimumValue.trim() : minimumValue;
  if (normalizedMinimum === "") return true;
  if (
    typeof normalizedMinimum !== "number" &&
    typeof normalizedMinimum !== "string"
  ) {
    return true;
  }

  const minimum = Number(normalizedMinimum);
  const minimumCents = Math.round(minimum * 100);
  if (
    !Number.isFinite(minimum) ||
    minimum < 0 ||
    !Number.isSafeInteger(minimumCents)
  ) {
    return true;
  }

  return subtotalCents < minimumCents;
}

export function calculatePdvDiscount(
  subtotal: number,
  coupon: {
    tipo: unknown;
    valor: unknown;
    minimo_pedido: unknown;
  } | null,
) {
  if (!coupon) return 0;

  const subtotalCents = Math.round(subtotal * 100);
  if (
    !Number.isFinite(subtotal) ||
    subtotal < 0 ||
    !Number.isSafeInteger(subtotalCents)
  ) {
    return 0;
  }

  // The minimum check must fail closed in the same render. The effect that
  // clears an invalid coupon only runs after render and cannot protect this
  // calculation from malformed local/API state.
  if (shouldInvalidatePdvCoupon(subtotal, coupon.minimo_pedido)) return 0;

  const tipo =
    typeof coupon.tipo === "string" ? coupon.tipo.trim().toLowerCase() : "";
  const normalizedValue =
    typeof coupon.valor === "string" ? coupon.valor.trim() : coupon.valor;

  if (
    normalizedValue === "" ||
    (typeof normalizedValue !== "number" &&
      typeof normalizedValue !== "string")
  ) {
    return 0;
  }

  const value = Number(normalizedValue);
  if (!Number.isFinite(value) || value < 0) return 0;

  if (["percentual", "porcentagem", "percent", "percentage"].includes(tipo)) {
    const percent = Math.min(value, 100);
    // Backend pdv_* sale/PIX functions round percentage discounts to 2 decimals.
    // subtotal * percent is the discount in cents, avoiding a larger
    // intermediate subtotalCents * percent value near JS's safe-integer limit.
    const discountCents = Math.round(subtotal * percent);
    if (
      !Number.isSafeInteger(discountCents) ||
      discountCents < 0 ||
      discountCents > subtotalCents
    ) {
      return 0;
    }
    return discountCents / 100;
  }

  if (["valor_fixo", "fixed", "fixo"].includes(tipo)) {
    const valueCents = Math.round(value * 100);
    if (!Number.isSafeInteger(valueCents) || valueCents < 0) return 0;
    return Math.min(subtotal, value);
  }

  return 0;
}

function pdvDecimalParts(value: number) {
  const [coefficient, exponentText] = value.toString().toLowerCase().split("e");
  const exponent = exponentText ? Number(exponentText) : 0;
  const [whole, fraction = ""] = coefficient.split(".");
  let units = BigInt(`${whole}${fraction}`);
  let scale = fraction.length - exponent;

  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }

  return { units, scale };
}

function pdvDecimalUnitsToNumber(units: bigint, scale: number) {
  if (scale === 0) return Number(units);

  const digits = units.toString().padStart(scale + 1, "0");
  const splitAt = digits.length - scale;
  return Number(`${digits.slice(0, splitAt)}.${digits.slice(splitAt)}`);
}

export function calculatePdvTotal(subtotal: number, discount: number) {
  const subtotalCents = Math.round(subtotal * 100);
  const discountCents = Math.round(discount * 100);

  if (
    !Number.isFinite(subtotal) ||
    subtotal < 0 ||
    !Number.isSafeInteger(subtotalCents) ||
    !Number.isFinite(discount) ||
    discount < 0 ||
    !Number.isSafeInteger(discountCents)
  ) {
    return 0;
  }

  // PostgreSQL numeric subtracts decimal values exactly. Align the decimal
  // serialization of both finite JS numbers into integer units first so
  // 0.30 - 0.10 cannot leak binary floating-point drift into the PDV total.
  // This also preserves valid fixed discounts with sub-cent precision.
  const subtotalParts = pdvDecimalParts(subtotal);
  const discountParts = pdvDecimalParts(discount);
  const scale = Math.max(subtotalParts.scale, discountParts.scale);
  const subtotalUnits =
    subtotalParts.units * 10n ** BigInt(scale - subtotalParts.scale);
  const discountUnits =
    discountParts.units * 10n ** BigInt(scale - discountParts.scale);

  if (discountUnits >= subtotalUnits) return 0;

  return pdvDecimalUnitsToNumber(subtotalUnits - discountUnits, scale);
}

type PdvValidatedCoupon = {
  codigo: string;
  tipo: "percent" | "fixed";
  valor: number;
  minimo_pedido: number;
};

function parsePdvValidatedCoupon(
  value: unknown,
  requestedCode: string,
): PdvValidatedCoupon | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  const codigo = typeof raw.codigo === "string" ? raw.codigo.trim() : "";
  const tipo =
    typeof raw.tipo === "string" ? raw.tipo.trim().toLowerCase() : "";
  const valor = typeof raw.valor === "number" ? raw.valor : Number.NaN;
  const minimoPedido =
    typeof raw.minimo_pedido === "number"
      ? raw.minimo_pedido
      : Number.NaN;

  const valorCents = Math.round(valor * 100);
  const minimoPedidoCents = Math.round(minimoPedido * 100);

  if (
    !codigo ||
    codigo.toUpperCase() !== requestedCode ||
    (tipo !== "percent" && tipo !== "fixed") ||
    !Number.isFinite(valor) ||
    valor < 0 ||
    (tipo === "percent" && valor > 100) ||
    !Number.isSafeInteger(valorCents) ||
    !Number.isFinite(minimoPedido) ||
    minimoPedido < 0 ||
    !Number.isSafeInteger(minimoPedidoCents)
  ) {
    return null;
  }

  return {
    codigo,
    tipo,
    valor,
    minimo_pedido: minimoPedido,
  };
}

function createPdvCartItemId(productId: string) {
  try {
    const id = globalThis.crypto?.randomUUID?.();
    if (typeof id === "string" && id) return id;
  } catch {
    // The cart row id is local-only; product ids are unique in the validated catalog.
  }
  return productId;
}

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
    setBooting(true);
    setOperador(null);
    setSessionToken("");
    setCaixaId(null);

    (async () => {
      try {
        try { localStorage.removeItem("pdv_session_v1"); } catch {}

        const saved = readPdvSession();
        if (!saved) return;

        const routeSlug = (slug || "").trim().toLowerCase();
        const savedSlug = saved.operador.org_slug.trim().toLowerCase();
        if (routeSlug && routeSlug !== savedSlug) {
          clearPdvSession();
          return;
        }

        const ctx = await validatePdvSession(saved.sessionToken);
        if (!active) return;

        if (!ctx) {
          clearPdvSession();
          return;
        }

        const sameOperator = String(ctx.operador_id || "") === saved.operador.id;
        const sameOrganization = String(ctx.organization_id || "") === saved.operador.organization_id;
        if (!sameOperator || !sameOrganization) {
          clearPdvSession();
          return;
        }

        setOperador(saved.operador as Operador);
        setSessionToken(saved.sessionToken);
        // The resumed server context is authoritative; never reuse a stale local cash register id.
        setCaixaId(ctx.caixa_aberto_id || null);
      } catch (error) {
        console.error("[PDV] session restore failed", error);
        if (active) toast.error("Não foi possível validar a sessão do PDV. Tente novamente.");
      } finally {
        if (active) setBooting(false);
      }
    })();

    return () => { active = false; };
  }, [slug]);

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
  const routeSlug = (slug || "").trim().toLowerCase();
  const [orgSlug, setOrgSlug] = useState(routeSlug);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (routeSlug) setOrgSlug(routeSlug);
  }, [routeSlug]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedSlug = (routeSlug || orgSlug).trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedSlug || !normalizedUsername || !password) {
      toast.error("Preencha loja, usuário e senha.");
      return;
    }

    // React state is asynchronous, so loading alone does not prevent two submit
    // events in the same tick. Keep a synchronous lock around the whole request.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);

    try {
      const res = await createPdvSession(normalizedSlug, normalizedUsername, password);
      if (!mountedRef.current) return;

      if (!res?.ok) {
        if (res?.reason === "too_many_attempts") {
          const rawRetrySeconds = Number(res?.retry_after_seconds);
          const retrySeconds =
            Number.isFinite(rawRetrySeconds) && rawRetrySeconds > 0
              ? Math.min(86400, Math.ceil(rawRetrySeconds))
              : 600;
          const minutes = Math.max(1, Math.ceil(retrySeconds / 60));
          toast.error(`Muitas tentativas incorretas. Aguarde cerca de ${minutes} minuto(s) e tente novamente.`);
          return;
        }
        if (res?.reason === "organization_unavailable") {
          toast.error("Esta loja está temporariamente indisponível para operar o PDV.");
          return;
        }
        if (res?.reason === "invalid_credentials") {
          const remaining = Number(res?.remaining_attempts);
          if (Number.isInteger(remaining) && remaining >= 0 && remaining <= 5) {
            toast.error(`Usuário ou senha inválidos. Restam ${remaining} tentativa(s).`);
          } else {
            toast.error("Usuário ou senha inválidos");
          }
          return;
        }
        toast.error("Usuário ou senha inválidos");
        return;
      }

      const op = res?.operador;
      const token = typeof res?.session_token === "string" ? res.session_token.trim() : "";
      const caixaAbertoId = res?.caixa_aberto_id;
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const validOperator =
        op &&
        typeof op.name === "string" &&
        op.name.trim().length > 0 &&
        typeof op.username === "string" &&
        op.username.trim().length > 0 &&
        typeof op.org_slug === "string" &&
        op.org_slug.trim().length > 0 &&
        typeof op.org_name === "string" &&
        op.org_name.trim().length > 0 &&
        typeof op.id === "string" &&
        uuidPattern.test(op.id) &&
        typeof op.organization_id === "string" &&
        uuidPattern.test(op.organization_id);
      const validToken = /^[0-9a-f]{64}$/i.test(token);
      const validCaixa =
        caixaAbertoId == null ||
        (typeof caixaAbertoId === "string" && uuidPattern.test(caixaAbertoId));
      const responseSlug =
        typeof op?.org_slug === "string" ? op.org_slug.trim().toLowerCase() : "";

      if (!validOperator || !validToken || !validCaixa || responseSlug !== normalizedSlug) {
        console.error("[PDV] invalid pdv_create_session success payload");
        toast.error("Resposta inválida ao iniciar a sessão do PDV. Tente novamente.");
        return;
      }

      toast.success(`Bem-vindo, ${op.name}`);
      onLogin(op as Operador, token, caixaAbertoId || null);
    } catch (error: any) {
      if (!mountedRef.current) return;
      console.error("[PDV] pdv_create_session failed", {
        code: error?.code,
        status: error?.status,
      });
      toast.error("Não foi possível conectar ao PDV. Tente novamente.");
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
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
          value={routeSlug || orgSlug}
          onChange={(e) => {
            if (!routeSlug) setOrgSlug(e.target.value);
          }}
          readOnly={Boolean(routeSlug)}
          placeholder="Identificador da loja (slug)"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 outline-none read-only:text-zinc-400"
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
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    const rawValue = valor.trim();
    const validMoneyFormat = /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(rawValue);
    const parsedValue = validMoneyFormat
      ? Number(rawValue.replace(/\./g, "").replace(",", "."))
      : Number.NaN;
    const cents = Math.round(parsedValue * 100);

    if (
      !Number.isFinite(parsedValue) ||
      parsedValue < 0 ||
      !Number.isSafeInteger(cents)
    ) {
      toast.error("Informe um saldo inicial válido.");
      return;
    }

    const v = cents / 100;

    // State updates are asynchronous; use a synchronous lock so two submit
    // events in the same tick can never open competing cash registers.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);

    try {
      const { data, error } = await pdvRpc.openCash(sessionToken, v);
      if (!mountedRef.current) return;

      if (error) {
        const transportError = error as any;
        console.error("[PDV] pdv_abrir_caixa_v2 failed", {
          code: transportError?.code,
          status: transportError?.status,
        });
        toast.error("Não foi possível abrir o caixa. Tente novamente.");
        return;
      }

      const res = data as any;
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (!res?.ok) {
        if (res?.reason === "invalid_session") {
          toast.error("Sessão expirada. Entre novamente.");
          onLogout();
          return;
        }

        if (res?.reason === "already_open") {
          const existingCaixaId =
            typeof res?.caixa_id === "string" ? res.caixa_id.trim() : "";
          if (!uuidPattern.test(existingCaixaId)) {
            console.error("[PDV] invalid pdv_abrir_caixa_v2 already_open payload");
            toast.error("Resposta inválida ao recuperar o caixa aberto. Tente novamente.");
            return;
          }

          toast.success("Caixa já estava aberto");
          onOpen(existingCaixaId);
          return;
        }

        toast.error("Erro ao abrir caixa");
        return;
      }

      const openedCaixaId =
        typeof res?.caixa_id === "string" ? res.caixa_id.trim() : "";
      if (!uuidPattern.test(openedCaixaId)) {
        console.error("[PDV] invalid pdv_abrir_caixa_v2 success payload");
        toast.error("Resposta inválida ao abrir o caixa. Tente novamente.");
        return;
      }

      toast.success("Caixa aberto");
      onOpen(openedCaixaId);
    } catch (error: any) {
      if (!mountedRef.current) return;
      console.error("[PDV] pdv_abrir_caixa_v2 rejected", {
        code: error?.code,
        status: error?.status,
      });
      toast.error("Não foi possível abrir o caixa. Tente novamente.");
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
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
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [forma, setForma] = useState<Forma>("dinheiro");

  const [cupomCode, setCupomCode] = useState("");
  const [cupomDesc, setCupomDesc] = useState<PdvValidatedCoupon | null>(null);
  const couponRequestIdRef = useRef(0);
  const couponMountedRef = useRef(true);
  const [customerPhone, setCustomerPhone] = useState("");

  useEffect(() => {
    couponMountedRef.current = true;
    return () => {
      couponMountedRef.current = false;
      couponRequestIdRef.current += 1;
    };
  }, []);

  const [showSangria, setShowSangria] = useState(false);
  const [showFechar, setShowFechar] = useState(false);
  const [showDevolucao, setShowDevolucao] = useState(false);
  const [saleLoading, setSaleLoading] = useState(false);
  const finalizeInFlightRef = useRef(false);
  const finalizeMountedRef = useRef(true);

  useEffect(() => {
    finalizeMountedRef.current = true;
    return () => {
      finalizeMountedRef.current = false;
      finalizeInFlightRef.current = false;
    };
  }, []);

  // Load products
  useEffect(() => {
    let active = true;

    // Never keep a previous session's catalog visible while a new token is being validated.
    setProducts([]);
    setCatalogState("loading");

    void (async () => {
      try {
        const { data, error } = await pdvRpc.catalog(sessionToken);
        if (!active) return;

        if (error) {
          const transportError = error as any;
          console.error("[PDV] pdv_catalog_v2 transport error", {
            code: transportError?.code,
            status: transportError?.status,
          });
          setCatalogState("error");
          toast.error("Não foi possível carregar os produtos do PDV. Tente novamente.");
          return;
        }

        const res = data as any;
        if (!res?.ok) {
          setCatalogState("error");

          if (res?.reason === "invalid_session") {
            toast.error("Sessão expirada. Entre novamente.");
            onLogout();
            return;
          }

          console.error("[PDV] pdv_catalog_v2 returned a non-success response");
          toast.error("Não foi possível carregar os produtos do PDV. Tente novamente.");
          return;
        }

        const parsedProducts = parsePdvCatalogProducts(res.products);
        if (!parsedProducts) {
          console.error("[PDV] invalid pdv_catalog_v2 success payload");
          setCatalogState("error");
          toast.error("Não foi possível carregar os produtos do PDV. Tente novamente.");
          return;
        }

        setProducts(parsedProducts);
        setCatalogState("ready");
      } catch (error: any) {
        if (!active) return;
        console.error("[PDV] pdv_catalog_v2 rejected", {
          code: error?.code,
          status: error?.status,
        });
        setCatalogState("error");
        toast.error("Não foi possível carregar os produtos do PDV. Tente novamente.");
      }
    })();

    return () => {
      active = false;
    };
  }, [sessionToken, onLogout]);

  // Focus search
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Global barcode listener
  useEffect(() => {
    let buffer = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
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
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => (buffer = ""), 300);
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, catalogState]);

  const barcodeMatches = (code: string) => {
    const needle = normalizePdvBarcode(code);
    if (!needle) return [];
    return products.filter(
      (product) => normalizePdvBarcode(product.codigo_barras || "") === needle,
    );
  };

  const tryAddByCode = (code: string) => {
    if (catalogState !== "ready") {
      toast.error(
        catalogState === "loading"
          ? "Aguarde os produtos terminarem de carregar."
          : "Catálogo indisponível. Recarregue o PDV.",
      );
      return false;
    }

    const matches = barcodeMatches(code);
    if (matches.length === 0) {
      toast.error("Produto não encontrado para este código.");
      return false;
    }

    if (matches.length > 1) {
      toast.error("Código de barras duplicado no catálogo. Selecione o produto manualmente.");
      return false;
    }

    const [product] = matches;
    if (!addToCart(product)) return false;

    beep();
    toast.success(`🛒 ${product.name} adicionado`);
    return true;
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
    const visibleItem = cart.find((item) => item.product_id === p.id);
    if (visibleItem && visibleItem.quantity >= PDV_MAX_ITEM_QUANTITY) {
      toast.error(`Quantidade máxima por produto: ${PDV_MAX_ITEM_QUANTITY}.`);
      return false;
    }

    setCart((prev) => {
      const i = prev.findIndex((x) => x.product_id === p.id);
      if (i >= 0) {
        const current = prev[i];
        if (current.quantity >= PDV_MAX_ITEM_QUANTITY) return prev;

        const c = [...prev];
        c[i] = {
          ...current,
          quantity: Math.min(PDV_MAX_ITEM_QUANTITY, current.quantity + 1),
        };
        return c;
      }

      return [
        ...prev,
        {
          id: createPdvCartItemId(p.id),
          product_id: p.id,
          name: p.name,
          price: p.price,
          quantity: 1,
        },
      ];
    });

    return true;
  };

  const changeQty = (id: string, delta: number) => {
    // The UI only emits +/-1, but keep the state transition defensive because
    // malformed quantities would otherwise poison subtotal/payment payloads.
    if (
      typeof id !== "string" ||
      !id ||
      !Number.isSafeInteger(delta) ||
      (delta !== 1 && delta !== -1)
    ) {
      return;
    }

    const visibleItem = cart.find((item) => item.id === id);
    if (delta > 0 && visibleItem?.quantity >= PDV_MAX_ITEM_QUANTITY) {
      toast.error(`Quantidade máxima por produto: ${PDV_MAX_ITEM_QUANTITY}.`);
      return;
    }

    setCart((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index < 0) return prev;

      // Duplicate local row ids are not valid. Refuse an ambiguous mutation
      // instead of changing more than one product at once.
      const duplicateIndex = prev.findIndex(
        (item, candidateIndex) => candidateIndex !== index && item.id === id,
      );
      if (duplicateIndex >= 0) return prev;

      const current = prev[index];
      if (
        !Number.isSafeInteger(current.quantity) ||
        current.quantity < 1 ||
        current.quantity > PDV_MAX_ITEM_QUANTITY
      ) {
        return prev;
      }

      const nextQuantity = current.quantity + delta;
      if (nextQuantity <= 0) {
        return prev.filter((_, candidateIndex) => candidateIndex !== index);
      }
      if (nextQuantity > PDV_MAX_ITEM_QUANTITY) return prev;

      const next = [...prev];
      next[index] = { ...current, quantity: nextQuantity };
      return next;
    });
  };

  const removeItem = (id: string) => {
    // Keep removal recoverable even if a legacy/local row id is malformed.
    // The only unsafe case is ambiguity: one action must never delete two rows.
    if (typeof id !== "string") return;

    setCart((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index < 0) return prev;

      // A duplicated local row id makes the target ambiguous. Never let one
      // remove action delete more than the single row the operator selected.
      const duplicateIndex = prev.findIndex(
        (item, candidateIndex) => candidateIndex !== index && item.id === id,
      );
      if (duplicateIndex >= 0) return prev;

      return [...prev.slice(0, index), ...prev.slice(index + 1)];
    });
  };

  const filtered = useMemo(() => {
    const nameQuery = normalizePdvSearchText(query);
    const barcodeQuery = query.trim().toLocaleLowerCase("pt-BR");
    if (!nameQuery && !barcodeQuery) return products.slice(0, 24);

    return products
      .filter((product) => {
        const nameMatches =
          Boolean(nameQuery) &&
          normalizePdvSearchText(product.name).includes(nameQuery);
        const barcodeMatchesQuery =
          Boolean(barcodeQuery) &&
          (product.codigo_barras || "")
            .trim()
            .toLocaleLowerCase("pt-BR")
            .includes(barcodeQuery);

        return nameMatches || barcodeMatchesQuery;
      })
      .slice(0, 48);
  }, [products, query]);

  const subtotal = calculatePdvSubtotal(cart);
  const subtotalRef = useRef(subtotal);
  subtotalRef.current = subtotal;

  useEffect(() => {
    if (
      cupomDesc &&
      shouldInvalidatePdvCoupon(subtotal, cupomDesc.minimo_pedido)
    ) {
      setCupomDesc(null);
    }
  }, [subtotal, cupomDesc]);

  const desconto = useMemo(
    () => calculatePdvDiscount(subtotal, cupomDesc),
    [cupomDesc, subtotal],
  );
  const total = calculatePdvTotal(subtotal, desconto);

  const aplicarCupom = async () => {
    const c = cupomCode.trim().toUpperCase();
    if (!c) return;

    const requestId = ++couponRequestIdRef.current;

    try {
      const { data, error } = await pdvRpc.validateCoupon(sessionToken, c);
      if (!couponMountedRef.current) return;

      if (error) {
        if (requestId !== couponRequestIdRef.current) return;
        const transportError = error as any;
        console.error("[PDV] pdv_validar_cupom_v2 transport error", {
          code: transportError?.code,
          status: transportError?.status,
        });
        toast.error("Não foi possível validar o cupom. Tente novamente.");
        return;
      }

      const res = data as any;
      if (!res || typeof res !== "object" || typeof res.ok !== "boolean") {
        if (requestId !== couponRequestIdRef.current) return;
        console.error("[PDV] invalid pdv_validar_cupom_v2 response");
        toast.error("Não foi possível validar o cupom. Tente novamente.");
        return;
      }

      if (res.ok === false) {
        if (res.reason === "invalid_session") {
          toast.error("Sessão expirada. Entre novamente.");
          onLogout();
          return;
        }

        if (requestId !== couponRequestIdRef.current) return;

        const messages: Record<string, string> = {
          not_found: "Cupom não encontrado",
          inactive: "Cupom inativo",
          not_started: "Cupom ainda não iniciou",
          expired: "Cupom expirado",
          invalid_code: "Cupom inválido",
          invalid_discount_type: "Cupom inválido",
        };
        toast.error(messages[res.reason] || "Cupom inválido");
        return;
      }

      if (requestId !== couponRequestIdRef.current) return;

      const cupom = parsePdvValidatedCoupon(res.cupom, c);
      if (!cupom) {
        console.error("[PDV] invalid pdv_validar_cupom_v2 success payload");
        toast.error("Não foi possível validar o cupom. Tente novamente.");
        return;
      }

      const currentSubtotal = subtotalRef.current;
      if (
        shouldInvalidatePdvCoupon(
          currentSubtotal,
          cupom.minimo_pedido,
        )
      ) {
        toast.error(
          `Pedido mínimo para este cupom: ${fmt(cupom.minimo_pedido)}`,
        );
        return;
      }

      setCupomDesc(cupom);
      toast.success(`Cupom ${cupom.codigo} aplicado`);
    } catch (error: any) {
      if (
        !couponMountedRef.current ||
        requestId !== couponRequestIdRef.current
      ) {
        return;
      }

      console.error("[PDV] pdv_validar_cupom_v2 rejected", {
        code: error?.code,
        status: error?.status,
      });
      toast.error("Não foi possível validar o cupom. Tente novamente.");
    }
  };

  // ---- Espelhamento p/ tela do cliente ----
  const bcRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("pdv-cliente");
      bcRef.current = channel;
    } catch {
      bcRef.current = null;
    }

    return () => {
      if (bcRef.current === channel) bcRef.current = null;
      try { channel?.close(); } catch {}
    };
  }, []);

  // 🟢 Gera Pix real (Mercado Pago) quando o operador escolhe PIX no PDV.
  // O QR + Copia-e-Cola viaja no broadcast e aparece GIGANTE na tela do cliente.
  const [pixData, setPixData] = useState<{ qrBase64: string; copiaECola: string; amount: number; intentId: string; cartSignature: string } | null>(null);
  const [pixLoading, setPixLoading] = useState(false);
  const pixReqId = useRef(0);
  const pixDataRef = useRef<typeof pixData>(null);

  const pixItems = useMemo(
    () => cart.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
    [cart],
  );
  const pixCartSignature = useMemo(
    () =>
      JSON.stringify(
        [...pixItems].sort((a, b) => a.product_id.localeCompare(b.product_id)),
      ),
    [pixItems],
  );
  const pixCouponCode = cupomDesc?.codigo || "";
  const pixInputKey = useMemo(
    () =>
      JSON.stringify({
        forma,
        total,
        cartSignature: pixCartSignature,
        couponCode: pixCouponCode,
        sessionToken,
        caixaId,
      }),
    [forma, total, pixCartSignature, pixCouponCode, sessionToken, caixaId],
  );
  const pixInputKeyRef = useRef(pixInputKey);
  pixInputKeyRef.current = pixInputKey;
  pixDataRef.current = pixData;

  useEffect(() => {
    let active = true;

    const requestSignature = `${pixCartSignature}|${pixCouponCode}`;
    const clearPixData = () => {
      pixDataRef.current = null;
      setPixData(null);
    };

    // Leaving PIX mode or losing a payable total invalidates both the visible
    // QR and any request that may already be in flight.
    if (forma !== "pix" || !Number.isFinite(total) || total <= 0) {
      pixReqId.current += 1;
      clearPixData();
      setPixLoading(false);
      return () => {
        active = false;
      };
    }

    // Reuse a QR only while the amount, semantic cart contents and coupon are
    // still the same. A new state object alone must never regenerate PIX.
    const currentPix = pixDataRef.current;
    if (
      currentPix &&
      Number.isFinite(currentPix.amount) &&
      Math.abs(currentPix.amount - total) < 0.005 &&
      currentPix.cartSignature === requestSignature
    ) {
      setPixLoading(false);
      return () => {
        active = false;
      };
    }

    const myReq = ++pixReqId.current;
    const requestKey = pixInputKey;

    // Do not keep an old payable QR visible while a different cart/coupon is
    // being debounced or quoted.
    clearPixData();
    setPixLoading(true);

    const isCurrentRequest = () =>
      active &&
      myReq === pixReqId.current &&
      pixInputKeyRef.current === requestKey;

    const t = setTimeout(async () => {
      // A render can change PIX inputs before this passive effect's cleanup
      // runs. Check the render-time key before creating any server intent.
      if (!isCurrentRequest()) return;

      try {
        let intentData: unknown;
        let intentError: unknown;

        try {
          const intentResult = await pdvRpc.createPixIntent(
            sessionToken,
            caixaId,
            pixItems,
            pixCouponCode,
          );
          intentData = intentResult.data;
          intentError = intentResult.error;
        } catch (error: any) {
          if (!isCurrentRequest()) return;

          console.error("[PDV] pdv_create_pix_intent_v2 rejected", {
            code: error?.code,
            status: error?.status,
          });
          clearPixData();
          toast.error("Não foi possível iniciar o PIX. Tente novamente.");
          return;
        }

        if (!isCurrentRequest()) return;

        if (intentError) {
          const transportError = intentError as any;
          console.error("[PDV] pdv_create_pix_intent_v2 transport error", {
            code: transportError?.code,
            status: transportError?.status,
          });
          clearPixData();
          toast.error("Não foi possível iniciar o PIX. Tente novamente.");
          return;
        }

        if (
          !intentData ||
          typeof intentData !== "object" ||
          Array.isArray(intentData)
        ) {
          console.error("[PDV] invalid pdv_create_pix_intent_v2 response");
          clearPixData();
          toast.error("Não foi possível iniciar o PIX. Tente novamente.");
          return;
        }

        const intentResponse = intentData as Record<string, unknown>;
        if (intentResponse.ok === false) {
          clearPixData();

          if (intentResponse.reason === "invalid_session") {
            toast.error("Sessão expirada. Entre novamente.");
            onLogout();
            return;
          }

          toast.error(pdvPixIntentReasonMessage(intentResponse.reason));
          return;
        }

        const intent = parsePdvPixIntentSuccess(intentData);
        if (!intent) {
          console.error("[PDV] invalid pdv_create_pix_intent_v2 success payload");
          clearPixData();
          toast.error("Não foi possível iniciar o PIX. Tente novamente.");
          return;
        }

        // Only a strictly validated, still-current server intent may cross the
        // trust boundary into the Mercado Pago Edge Function.
        if (!isCurrentRequest()) return;

        let edgeData: unknown;
        let edgeError: unknown;

        try {
          const edgeResult = await supabase.functions.invoke(
            "mercadopago-create-pix",
            {
              body: {
                intent_id: intent.intent_id,
                session_token: sessionToken,
              },
            },
          );
          edgeData = edgeResult.data;
          edgeError = edgeResult.error;
        } catch (error: any) {
          if (!isCurrentRequest()) return;

          console.error("[PDV] mercadopago-create-pix rejected", {
            name: typeof error?.name === "string" ? error.name : undefined,
            status:
              typeof error?.status === "number"
                ? error.status
                : typeof error?.context?.status === "number"
                  ? error.context.status
                  : undefined,
          });
          clearPixData();
          toast.error("Não foi possível gerar o PIX. Tente novamente.");
          return;
        }

        if (!isCurrentRequest()) return;

        if (edgeError) {
          const functionError = edgeError as any;
          console.error("[PDV] mercadopago-create-pix error", {
            name:
              typeof functionError?.name === "string"
                ? functionError.name
                : undefined,
            status:
              typeof functionError?.status === "number"
                ? functionError.status
                : typeof functionError?.context?.status === "number"
                  ? functionError.context.status
                  : undefined,
          });
          clearPixData();
          toast.error("Não foi possível gerar o PIX. Tente novamente.");
          return;
        }

        const edge = parsePdvCreatePixSuccess(edgeData, intent);
        if (!edge) {
          console.error("[PDV] invalid mercadopago-create-pix success payload");
          clearPixData();
          toast.error("Não foi possível gerar o PIX. Tente novamente.");
          return;
        }

        if (!isCurrentRequest()) return;

        const nextPixData = {
          qrBase64: edge.qr_code_base64,
          copiaECola: edge.qr_code,
          amount: edge.amount,
          intentId: edge.intent_id,
          cartSignature: requestSignature,
        };
        pixDataRef.current = nextPixData;
        setPixData(nextPixData);
      } finally {
        if (isCurrentRequest()) setPixLoading(false);
      }
    }, 350); // pequeno debounce p/ não disparar a cada centavo

    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [
    forma,
    total,
    pixItems,
    pixCartSignature,
    pixCouponCode,
    sessionToken,
    caixaId,
    pixInputKey,
  ]);

  const [pixConfirmed, setPixConfirmed] = useState(false);
  const pixPollingKey = `${forma}|${sessionToken}|${pixData?.intentId || ""}|${pixData?.amount ?? ""}`;
  const pixPollingKeyRef = useRef(pixPollingKey);
  pixPollingKeyRef.current = pixPollingKey;

  useEffect(() => {
    setPixConfirmed(false);
    if (forma !== "pix" || !pixData?.intentId || !sessionToken) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const expectedIntentId = pixData.intentId;
    const expectedAmount = pixData.amount;
    const requestKey = pixPollingKey;

    const isCurrentPolling = () =>
      active && pixPollingKeyRef.current === requestKey;

    const scheduleNext = (delay: number) => {
      if (!isCurrentPolling()) return;
      timer = setTimeout(() => {
        void check();
      }, delay);
    };

    const stopForTerminalStatus = (
      status: PdvPixStatusSuccess["status"],
    ) => {
      active = false;
      const messages: Partial<
        Record<PdvPixStatusSuccess["status"], string>
      > = {
        failed: "Pagamento PIX recusado ou cancelado.",
        cancelled: "Pagamento PIX cancelado.",
        expired: "PIX expirado.",
        consumed: "PIX já foi utilizado.",
      };
      const message = messages[status];
      if (message) toast.error(message);
    };

    const check = async () => {
      if (!isCurrentPolling()) return;

      let data: unknown;
      let error: unknown;

      try {
        const result = await pdvRpc.pixStatus(sessionToken, expectedIntentId);
        data = result.data;
        error = result.error;
      } catch (pollError: any) {
        if (!isCurrentPolling()) return;
        console.error("[PDV] pdv_pix_status_v2 rejected", {
          code: pollError?.code,
          status: pollError?.status,
        });
        scheduleNext(2500);
        return;
      }

      if (!isCurrentPolling()) return;

      if (error) {
        const transportError = error as any;
        console.error("[PDV] pdv_pix_status_v2 transport error", {
          code: transportError?.code,
          status: transportError?.status,
        });
        scheduleNext(2500);
        return;
      }

      if (data && typeof data === "object" && !Array.isArray(data)) {
        const response = data as Record<string, unknown>;
        if (response.ok === false) {
          if (response.reason === "invalid_session") {
            active = false;
            toast.error("Sessão expirada. Entre novamente.");
            onLogout();
            return;
          }

          if (response.reason === "intent_not_found") {
            active = false;
            toast.error("PIX não encontrado. Gere um novo PIX.");
            return;
          }
        }
      }

      const status = parsePdvPixStatusSuccess(
        data,
        expectedIntentId,
        expectedAmount,
      );
      if (!status) {
        console.error("[PDV] invalid pdv_pix_status_v2 response");
        scheduleNext(2500);
        return;
      }

      if (status.status === "paid" && status.paid) {
        active = false;
        setPixConfirmed(true);
        toast.success("PIX confirmado");
        return;
      }

      if (
        status.status === "failed" ||
        status.status === "cancelled" ||
        status.status === "expired" ||
        status.status === "consumed"
      ) {
        stopForTerminalStatus(status.status);
        return;
      }

      scheduleNext(2500);
    };

    scheduleNext(1200);

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [
    forma,
    pixData?.intentId,
    pixData?.amount,
    sessionToken,
    pixPollingKey,
    onLogout,
  ]);

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
    } catch {}
    try {
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

  useEffect(() => {
    if (!lastReceipt) return;

    let printTimer: ReturnType<typeof setTimeout> | undefined;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

    // Wait for React to commit the receipt DOM, but keep every delayed print
    // owned by this receipt lifecycle so unmount/replacement cannot print stale UI.
    const renderTimer = setTimeout(() => {
      document.body.classList.add("printing-cupom");
      printTimer = setTimeout(() => {
        try {
          window.print();
        } catch (error) {
          console.error("[PDV] receipt print failed", error);
        } finally {
          cleanupTimer = setTimeout(() => {
            document.body.classList.remove("printing-cupom");
          }, 300);
        }
      }, 80);
    }, 60);

    return () => {
      clearTimeout(renderTimer);
      if (printTimer) clearTimeout(printTimer);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      document.body.classList.remove("printing-cupom");
    };
  }, [lastReceipt]);

  const finalizar = async () => {
    // State updates are asynchronous. Keep a synchronous lock around the
    // complete finalize flow so two clicks cannot run competing PIX checks.
    if (finalizeInFlightRef.current) return;
    finalizeInFlightRef.current = true;

    try {
      if (forma === "pix") {
        if (!pixData?.intentId) {
          toast.error("Gere o PIX antes de finalizar");
          return;
        }

        if (!pixConfirmed) {
          const expectedIntentId = pixData.intentId;
          const expectedAmount = pixData.amount;
          const requestKey = pixInputKeyRef.current;

          const isCurrentManualPix = () => {
            const currentPix = pixDataRef.current;
            if (
              !finalizeMountedRef.current ||
              pixInputKeyRef.current !== requestKey ||
              currentPix?.intentId !== expectedIntentId
            ) {
              return false;
            }

            const currentAmountCents = Math.round(
              (currentPix?.amount ?? Number.NaN) * 100,
            );
            const expectedAmountCents = Math.round(expectedAmount * 100);
            return (
              Number.isFinite(currentPix?.amount) &&
              Number.isSafeInteger(currentAmountCents) &&
              Number.isSafeInteger(expectedAmountCents) &&
              currentAmountCents === expectedAmountCents
            );
          };

          let pixStatusData: unknown;
          let pixStatusError: unknown;

          try {
            const result = await pdvRpc.pixStatus(
              sessionToken,
              expectedIntentId,
            );
            pixStatusData = result.data;
            pixStatusError = result.error;
          } catch (statusError: any) {
            if (!isCurrentManualPix()) return;

            console.error("[PDV] manual pdv_pix_status_v2 rejected", {
              code: statusError?.code,
              status: statusError?.status,
            });
            toast.error("Não foi possível confirmar o PIX. Tente novamente.");
            return;
          }

          // A response for an old QR/cart/coupon/payment mode/session must never
          // authorize the state that is current after the await.
          if (!isCurrentManualPix()) return;

          if (pixStatusError) {
            const transportError = pixStatusError as any;
            console.error("[PDV] manual pdv_pix_status_v2 transport error", {
              code: transportError?.code,
              status: transportError?.status,
            });
            toast.error("Não foi possível confirmar o PIX. Tente novamente.");
            return;
          }

          if (
            pixStatusData &&
            typeof pixStatusData === "object" &&
            !Array.isArray(pixStatusData)
          ) {
            const response = pixStatusData as Record<string, unknown>;

            if (response.ok === false) {
              if (response.reason === "invalid_session") {
                toast.error("Sessão expirada. Entre novamente.");
                onLogout();
                return;
              }

              if (response.reason === "intent_not_found") {
                toast.error("PIX não encontrado. Gere um novo PIX.");
                return;
              }

              toast.error("Pagamento PIX ainda não confirmado");
              return;
            }
          }

          const pixStatus = parsePdvPixStatusSuccess(
            pixStatusData,
            expectedIntentId,
            expectedAmount,
          );
          if (!pixStatus) {
            console.error("[PDV] invalid manual pdv_pix_status_v2 response");
            toast.error("Pagamento PIX ainda não confirmado");
            return;
          }

          if (
            pixStatus.status === "failed" ||
            pixStatus.status === "cancelled" ||
            pixStatus.status === "expired" ||
            pixStatus.status === "consumed"
          ) {
            const messages: Record<
              "failed" | "cancelled" | "expired" | "consumed",
              string
            > = {
              failed: "Pagamento PIX recusado ou cancelado.",
              cancelled: "Pagamento PIX cancelado.",
              expired: "PIX expirado.",
              consumed: "PIX já foi utilizado.",
            };
            toast.error(messages[pixStatus.status]);
            return;
          }

          if (pixStatus.status !== "paid" || !pixStatus.paid) {
            toast.error("Pagamento PIX ainda não confirmado");
            return;
          }

          if (!isCurrentManualPix()) return;
          setPixConfirmed(true);
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
    let res: any;

    if (forma === "pix" && pixData?.intentId) {
      const expectedIntentId = pixData.intentId;
      const expectedAmount = pixData.amount;
      const requestKey = pixInputKeyRef.current;

      const isCurrentPixSale = () => {
        const currentPix = pixDataRef.current;
        if (
          !finalizeMountedRef.current ||
          pixInputKeyRef.current !== requestKey ||
          currentPix?.intentId !== expectedIntentId
        ) {
          return false;
        }

        const currentAmountCents = Math.round(
          (currentPix?.amount ?? Number.NaN) * 100,
        );
        const expectedAmountCents = Math.round(expectedAmount * 100);
        return (
          Number.isFinite(currentPix?.amount) &&
          Number.isSafeInteger(currentAmountCents) &&
          Number.isSafeInteger(expectedAmountCents) &&
          currentAmountCents === expectedAmountCents
        );
      };

      let pixSaleData: unknown;
      let pixSaleError: unknown;

      try {
        const result = await pdvRpc.pixSale(sessionToken, expectedIntentId);
        pixSaleData = result.data;
        pixSaleError = result.error;
      } catch (saleError: any) {
        if (finalizeMountedRef.current) setSaleLoading(false);
        if (!isCurrentPixSale()) return;

        console.error("[PDV] pdv_registrar_venda_pix_v2 rejected", {
          code: saleError?.code,
          status: saleError?.status,
        });
        toast.error("Não foi possível registrar a venda PIX. Tente novamente.");
        return;
      }

      if (finalizeMountedRef.current) setSaleLoading(false);

      // The RPC may have completed server-side while the operator changed the
      // cart/coupon/payment mode or a replacement QR became current. Never let
      // that old response mutate the newer local sale state.
      if (!isCurrentPixSale()) return;

      if (pixSaleError) {
        const transportError = pixSaleError as any;
        console.error("[PDV] pdv_registrar_venda_pix_v2 transport error", {
          code: transportError?.code,
          status: transportError?.status,
        });
        toast.error("Não foi possível registrar a venda PIX. Tente novamente.");
        return;
      }

      if (
        pixSaleData &&
        typeof pixSaleData === "object" &&
        !Array.isArray(pixSaleData)
      ) {
        const response = pixSaleData as Record<string, unknown>;
        if (response.ok === false) {
          if (response.reason === "invalid_session") {
            toast.error("Sessão expirada. Entre novamente.");
            onLogout();
            return;
          }

          toast.error(pdvPixSaleReasonMessage(response.reason));
          return;
        }
      }

      const parsedSale = parsePdvPixSaleSuccess(
        pixSaleData,
        expectedAmount,
      );
      if (!parsedSale) {
        console.error("[PDV] invalid pdv_registrar_venda_pix_v2 response");
        toast.error(
          "Resposta inválida ao registrar a venda PIX. Tente novamente.",
        );
        return;
      }

      if (!isCurrentPixSale()) return;
      res = parsedSale;
    } else {
      const requestKey = pixInputKeyRef.current;
      const isCurrentNonPixSale = () =>
        finalizeMountedRef.current &&
        pixInputKeyRef.current === requestKey;

      let saleData: unknown;
      let saleError: unknown;

      try {
        const result = await pdvRpc.sale(
          sessionToken,
          caixaId,
          items,
          forma,
          total,
          snapCupom,
          desconto,
        );
        saleData = result.data;
        saleError = result.error;
      } catch (saleRequestError: any) {
        if (finalizeMountedRef.current) setSaleLoading(false);
        if (!isCurrentNonPixSale()) return;

        console.error("[PDV] pdv_registrar_venda_v2 rejected", {
          code: saleRequestError?.code,
          status: saleRequestError?.status,
        });
        toast.error("Não foi possível registrar a venda. Tente novamente.");
        return;
      }

      if (finalizeMountedRef.current) setSaleLoading(false);

      // A completed request belongs only to the cart/payment/coupon/session/cash
      // snapshot that started it. Never clear a newer comanda with an old reply.
      if (!isCurrentNonPixSale()) return;

      if (saleError) {
        const transportError = saleError as any;
        console.error("[PDV] pdv_registrar_venda_v2 transport error", {
          code: transportError?.code,
          status: transportError?.status,
        });
        toast.error("Não foi possível registrar a venda. Tente novamente.");
        return;
      }

      if (
        saleData &&
        typeof saleData === "object" &&
        !Array.isArray(saleData) &&
        (saleData as Record<string, unknown>).ok === false
      ) {
        const reason = (saleData as Record<string, unknown>).reason;

        if (reason === "invalid_session") {
          toast.error("Sessão expirada. Entre novamente.");
          onLogout();
          return;
        }

        if (reason === "invalid_cash_register") {
          toast.error("Caixa não está mais aberto. Reabra o caixa.");
          onClose();
          return;
        }

        toast.error(pdvNonPixSaleReasonMessage(reason));
        return;
      }

      const parsedSale = parsePdvNonPixSaleSuccess(saleData);
      if (!parsedSale) {
        console.error("[PDV] invalid pdv_registrar_venda_v2 response");
        toast.error(
          "Resposta inválida ao registrar a venda. Tente novamente.",
        );
        return;
      }

      if (!isCurrentNonPixSale()) return;
      res = parsedSale;
    }
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

    // 📱 Persiste telefone do cliente + dispara WhatsApp sem bloquear o
    // commit local de uma venda que já foi concluída no servidor.
    const phoneDigits = customerPhone.replace(/\D/g, "");
    if (phoneDigits.length >= 10 && res.order_id) {
      const orderId = res.order_id;
      void (async () => {
        try {
          // garante DDI 55 (Brasil) quando o operador digita só DDD+número
          const waNumber = phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`;

          const { data: phoneData, error: phoneError } = await pdvRpc.setOrderCustomerPhone(
            sessionToken,
            orderId,
            phoneDigits,
          );
          const phoneRes = phoneData as any;
          if (phoneError || !phoneRes?.ok) {
            console.error("[PDV] secure customer phone update failed", phoneError || phoneRes?.reason);
            toast.error("Venda concluída, mas não foi possível salvar o telefone do cliente");
          }

          const trackUrl = `${window.location.origin}/acompanhar/${orderId}`;
          const msg =
            `Olá! Seu pedido na ${BRAND_NAME} já foi recebido e já está em preparo na cozinha! 🍳 ` +
            `Confira seu cupom fiscal digital e acompanhe o status em tempo real por este link: ${trackUrl}`;
          const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}`;
          window.open(waUrl, "_blank", "noopener,noreferrer");
          toast.success("WhatsApp aberto para envio ao cliente 📲");
        } catch (e) {
          console.error("[PDV] whatsapp dispatch", e);
        }
      })();
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
    // Cross the post-sale boundary atomically: invalidate async work owned by
    // the completed comanda before publishing the empty/default state.
    couponRequestIdRef.current += 1;
    pixReqId.current += 1;
    pixDataRef.current = null;
    pixInputKeyRef.current = "";
    pixPollingKeyRef.current = "";
    setPixData(null);
    setPixLoading(false);
    setPixConfirmed(false);

    setCart([]);
    setCupomDesc(null);
    setCupomCode("");
    setCustomerPhone("");
    setForma("dinheiro");
    searchRef.current?.focus();
    } finally {
      finalizeInFlightRef.current = false;
    }
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
                if (e.key !== "Enter") return;
                e.preventDefault();

                const rawQuery = e.currentTarget.value.trim();
                if (!rawQuery) return;

                if (catalogState !== "ready") {
                  toast.error(
                    catalogState === "loading"
                      ? "Aguarde os produtos terminarem de carregar."
                      : "Catálogo indisponível. Recarregue o PDV.",
                  );
                  return;
                }

                const exactBarcodeMatches = barcodeMatches(rawQuery);
                if (exactBarcodeMatches.length > 0) {
                  if (tryAddByCode(rawQuery)) setQuery("");
                  return;
                }

                const normalizedNameQuery = normalizePdvSearchText(rawQuery);
                const firstNameMatch = filtered.find(
                  (product) =>
                    Boolean(normalizedNameQuery) &&
                    normalizePdvSearchText(product.name).includes(normalizedNameQuery),
                );

                if (firstNameMatch) {
                  addToCart(firstNameMatch);
                  setQuery("");
                  return;
                }

                if (filtered.length > 0) {
                  toast.error(
                    "Código de barras incompleto ou não encontrado. Refine a busca ou selecione o produto.",
                  );
                  return;
                }

                toast.error("Nenhum produto encontrado para essa busca.");
              }}
              placeholder="Buscar produto ou bipar código de barras…"
              className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-zinc-500"
              style={{ filter: "none", mixBlendMode: "normal" }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {catalogState === "loading" && (
              <div className="col-span-full text-center text-zinc-500 text-sm py-8 inline-flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando produtos…
              </div>
            )}
            {catalogState === "error" && (
              <div className="col-span-full text-center text-red-300 text-sm py-8">
                Não foi possível carregar os produtos do PDV.
              </div>
            )}
            {catalogState === "ready" && filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="text-left bg-zinc-900 border border-zinc-800 hover:border-amber-500/40 rounded-xl p-3 transition-colors"
              >
                <div className="text-sm font-semibold text-white line-clamp-2 min-h-[2.5rem]">
                  {p.name}
                </div>
                <div className="text-amber-400 font-bold mt-1">{fmt(p.price)}</div>
                {p.codigo_barras && (
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">
                    {p.codigo_barras}
                  </div>
                )}
              </button>
            ))}
            {catalogState === "ready" && filtered.length === 0 && (
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
                onChange={(e) => {
                  couponRequestIdRef.current += 1;
                  setCupomCode(e.target.value.toUpperCase());
                }}
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
          onInvalidCash={onClose}
          onLogout={onLogout}
        />
      )}
      {showDevolucao && (
        <DevolucaoModal
          operador={operador}
          sessionToken={sessionToken}
          caixaId={caixaId}
          onClose={() => setShowDevolucao(false)}
          onInvalidCash={onClose}
          onLogout={onLogout}
        />
      )}
      {showFechar && (
        <FechamentoModal
          operador={operador}
          sessionToken={sessionToken}
          caixaId={caixaId}
          onClose={() => setShowFechar(false)}
          onInvalidCash={onClose}
          onLogout={onLogout}
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
  onInvalidCash,
  onLogout,
}: {
  operador: Operador;
  sessionToken: string;
  caixaId: string;
  onClose: () => void;
  onInvalidCash: () => void;
  onLogout: () => void;
}) {
  const [tipo, setTipo] = useState<"sangria" | "suprimento">("sangria");
  const [valor, setValor] = useState("0,00");
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      submittingRef.current = false;
    };
  }, []);

  const submit = async () => {
    const rawValue = valor.trim();
    const validMoneyFormat = /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(rawValue);
    const parsedValue = validMoneyFormat
      ? Number(rawValue.replace(/\./g, "").replace(",", "."))
      : Number.NaN;
    const cents = Math.round(parsedValue * 100);

    if (
      !Number.isFinite(parsedValue) ||
      parsedValue <= 0 ||
      !Number.isSafeInteger(cents) ||
      cents >= Number.MAX_SAFE_INTEGER
    ) {
      toast.error("Informe um valor válido");
      return;
    }

    const v = cents / 100;
    const trimmedReason = motivo.trim();
    if (trimmedReason.length < 3) {
      toast.error("Informe um motivo");
      return;
    }

    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);

    try {
      const { data, error } = await pdvRpc.movement(
        sessionToken,
        caixaId,
        tipo,
        "dinheiro",
        v,
        trimmedReason,
      );
      if (!mountedRef.current) return;

      if (error) {
        const transportError = error as any;
        console.error("[PDV] pdv_registrar_movimento_v2 transport error", {
          code: transportError?.code,
          status: transportError?.status,
        });
        toast.error("Não foi possível registrar a movimentação. Tente novamente.");
        return;
      }

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        console.error("[PDV] invalid pdv_registrar_movimento_v2 payload");
        toast.error("Resposta inválida ao registrar a movimentação. Tente novamente.");
        return;
      }

      const res = data as Record<string, unknown>;
      if (res.ok !== true) {
        if (res.ok !== false) {
          console.error("[PDV] invalid pdv_registrar_movimento_v2 success payload");
          toast.error("Resposta inválida ao registrar a movimentação. Tente novamente.");
          return;
        }

        if (res.reason === "invalid_session") {
          toast.error("Sessão expirada. Entre novamente.");
          onLogout();
          return;
        }

        if (res.reason === "invalid_cash") {
          toast.error("Caixa não está mais aberto. Reabra o caixa.");
          onInvalidCash();
          return;
        }

        if (res.reason === "invalid_movement") {
          toast.error("Movimentação rejeitada. Confira valor e motivo.");
          return;
        }

        console.error("[PDV] pdv_registrar_movimento_v2 returned a non-success response");
        toast.error("Não foi possível registrar a movimentação. Tente novamente.");
        return;
      }

      toast.success(tipo === "sangria" ? "Sangria registrada" : "Suprimento registrado");
      onClose();
    } catch (error: any) {
      if (!mountedRef.current) return;
      console.error("[PDV] pdv_registrar_movimento_v2 rejected", {
        code: error?.code,
        status: error?.status,
      });
      toast.error("Não foi possível registrar a movimentação. Tente novamente.");
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
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

type PdvRefundItem = {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
};

type PdvRefundOrder = {
  id: string;
  order_number: string;
  customer_name: string | null;
  total: number;
  items: PdvRefundItem[];
};

function pdvMoneyToSafeCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  const cents = Math.round(value * 100);
  if (
    !Number.isSafeInteger(cents) ||
    Math.abs(value * 100 - cents) > 1e-7
  ) {
    return null;
  }

  return cents;
}

function parsePdvRefundOrder(value: unknown): PdvRefundOrder | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const payload = value as Record<string, unknown>;
  if (payload.ok !== true) return null;

  const rawOrder = payload.order;
  if (!rawOrder || typeof rawOrder !== "object" || Array.isArray(rawOrder)) {
    return null;
  }

  const order = rawOrder as Record<string, unknown>;
  const id = typeof order.id === "string" ? order.id.trim() : "";
  if (!PDV_UUID_PATTERN.test(id)) return null;

  const totalCents = pdvMoneyToSafeCents(order.total);
  if (totalCents === null) return null;

  if (!Array.isArray(order.items) || order.items.length === 0) return null;

  const items: PdvRefundItem[] = [];
  for (const rawItem of order.items) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      return null;
    }

    const item = rawItem as Record<string, unknown>;
    const productId =
      typeof item.product_id === "string" ? item.product_id.trim() : "";
    const quantity = item.quantity;
    const priceCents = pdvMoneyToSafeCents(item.price);

    if (
      !PDV_UUID_PATTERN.test(productId) ||
      typeof quantity !== "number" ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      priceCents === null
    ) {
      return null;
    }

    items.push({
      product_id: productId,
      name:
        typeof item.name === "string" && item.name.trim()
          ? item.name.trim()
          : "Produto",
      quantity,
      price: priceCents / 100,
    });
  }

  return {
    id,
    order_number:
      typeof order.order_number === "string" ? order.order_number : "",
    customer_name:
      typeof order.customer_name === "string" ? order.customer_name : null,
    total: totalCents / 100,
    items,
  };
}

function calculatePdvRefundTotal(
  items: PdvRefundItem[],
  selected: Record<string, number>,
): number | null {
  let totalCents = 0;

  for (const item of items) {
    const quantity = selected[item.product_id] ?? 0;
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 0 ||
      quantity > item.quantity
    ) {
      return null;
    }

    const priceCents = pdvMoneyToSafeCents(item.price);
    if (priceCents === null) return null;

    const lineCents = priceCents * quantity;
    if (!Number.isSafeInteger(lineCents)) return null;

    totalCents += lineCents;
    if (!Number.isSafeInteger(totalCents)) return null;
  }

  return totalCents / 100;
}

function parsePdvRefundSuccess(
  value: unknown,
  expectedOrderId: string,
): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const payload = value as Record<string, unknown>;
  if (payload.ok !== true) return null;

  const orderId =
    typeof payload.order_id === "string" ? payload.order_id.trim() : "";
  if (orderId !== expectedOrderId) return null;
  if (!Array.isArray(payload.items)) return null;

  const refundCents = pdvMoneyToSafeCents(payload.valor_devolucao);
  if (refundCents === null || refundCents <= 0) return null;

  return refundCents / 100;
}

function DevolucaoModal({
  operador,
  sessionToken,
  caixaId,
  onClose,
  onInvalidCash,
  onLogout,
}: {
  operador: Operador;
  sessionToken: string;
  caixaId: string;
  onClose: () => void;
  onInvalidCash: () => void;
  onLogout: () => void;
}) {
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<PdvRefundOrder | null>(null);
  const [items, setItems] = useState<PdvRefundItem[]>([]);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const searchRequestIdRef = useRef(0);
  const refundRequestIdRef = useRef(0);
  const searchingRef = useRef(false);
  const refundingRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      searchRequestIdRef.current += 1;
      refundRequestIdRef.current += 1;
      searchingRef.current = false;
      refundingRef.current = false;
    };
  }, []);

  const invalidateAsyncWork = () => {
    searchRequestIdRef.current += 1;
    refundRequestIdRef.current += 1;
    searchingRef.current = false;
    refundingRef.current = false;
  };

  const closeModal = () => {
    invalidateAsyncWork();
    onClose();
  };

  const clearLoadedOrder = () => {
    setOrder(null);
    setItems([]);
    setSelected({});
  };

  const changeOrderId = (value: string) => {
    setOrderId(value);
    clearLoadedOrder();

    // A result belongs to the exact query that started it. If the operator edits
    // the query while a lookup is pending, invalidate that lookup immediately so
    // a new search can start and the obsolete response cannot populate the modal.
    if (searchingRef.current) {
      searchRequestIdRef.current += 1;
      searchingRef.current = false;
      setLoading(refundingRef.current);
    }
  };

  const buscar = async () => {
    const query = orderId.trim();
    if (query.length < 4) {
      toast.error("Informe ao menos 4 caracteres do pedido");
      return;
    }
    if (searchingRef.current || refundingRef.current) return;

    searchingRef.current = true;
    const requestId = ++searchRequestIdRef.current;
    setLoading(true);
    clearLoadedOrder();

    try {
      let data: unknown;
      let error: unknown;

      try {
        const result = await pdvRpc.findOrder(sessionToken, query);
        data = result.data;
        error = result.error;
      } catch (lookupError) {
        if (
          !mountedRef.current ||
          requestId !== searchRequestIdRef.current
        ) {
          return;
        }

        console.error("[PDV] pdv_buscar_pedido_v2 rejected", lookupError);
        toast.error("Não foi possível buscar o pedido. Tente novamente.");
        return;
      }

      if (
        !mountedRef.current ||
        requestId !== searchRequestIdRef.current
      ) {
        return;
      }

      if (error) {
        const transportError = error as any;
        console.error("[PDV] pdv_buscar_pedido_v2 transport error", {
          code: transportError?.code,
          status: transportError?.status,
        });
        toast.error("Não foi possível buscar o pedido. Tente novamente.");
        return;
      }

      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        (data as Record<string, unknown>).ok === false
      ) {
        const reason = (data as Record<string, unknown>).reason;

        if (reason === "invalid_session") {
          toast.error("Sessão expirada. Entre novamente.");
          invalidateAsyncWork();
          onLogout();
          return;
        }

        if (reason === "order_not_found") {
          toast.error("Pedido não encontrado");
          return;
        }

        if (reason === "invalid_query") {
          toast.error("Informe ao menos 4 caracteres do pedido");
          return;
        }

        toast.error("Não foi possível buscar o pedido. Tente novamente.");
        return;
      }

      const parsedOrder = parsePdvRefundOrder(data);
      if (!parsedOrder) {
        toast.error("Resposta inválida ao buscar o pedido. Tente novamente.");
        return;
      }

      setOrder(parsedOrder);
      setItems(parsedOrder.items);
      setSelected({});
    } finally {
      if (
        mountedRef.current &&
        requestId === searchRequestIdRef.current
      ) {
        searchingRef.current = false;
        setLoading(false);
      }
    }
  };

  const toggleQty = (
    productId: string,
    delta: -1 | 1,
    max: number,
  ) => {
    if (!PDV_UUID_PATTERN.test(productId) || !Number.isSafeInteger(max) || max <= 0) {
      return;
    }

    setSelected((current) => {
      const previous = current[productId] ?? 0;
      if (!Number.isSafeInteger(previous) || previous < 0) {
        return current;
      }

      const next = Math.max(0, Math.min(max, previous + delta));
      if (next === previous) return current;
      return { ...current, [productId]: next };
    });
  };

  const valorTotal = useMemo(
    () => calculatePdvRefundTotal(items, selected),
    [items, selected],
  );

  const confirmar = async () => {
    if (refundingRef.current || searchingRef.current) return;
    if (!order) return;

    const devolvidos = items
      .map((item) => ({
        product_id: item.product_id,
        quantity: selected[item.product_id] ?? 0,
      }))
      .filter((item) => item.quantity > 0);

    if (devolvidos.length === 0) {
      toast.error("Selecione ao menos 1 item");
      return;
    }

    const trimmedReason = motivo.trim();
    if (trimmedReason.length < 3) {
      toast.error("Informe o motivo");
      return;
    }

    if (valorTotal === null) {
      toast.error("Itens selecionados inválidos. Busque o pedido novamente.");
      return;
    }

    refundingRef.current = true;
    const requestId = ++refundRequestIdRef.current;
    setLoading(true);

    try {
      let data: unknown;
      let error: unknown;

      try {
        const result = await pdvRpc.refund(
          sessionToken,
          caixaId,
          order.id,
          devolvidos,
          valorTotal,
          trimmedReason,
        );
        data = result.data;
        error = result.error;
      } catch (refundError) {
        if (
          !mountedRef.current ||
          requestId !== refundRequestIdRef.current
        ) {
          return;
        }

        console.error("[PDV] pdv_devolver_pedido_v2 rejected", refundError);
        toast.error("Não foi possível processar a devolução. Tente novamente.");
        return;
      }

      if (
        !mountedRef.current ||
        requestId !== refundRequestIdRef.current
      ) {
        return;
      }

      if (error) {
        const transportError = error as any;
        console.error("[PDV] pdv_devolver_pedido_v2 transport error", {
          code: transportError?.code,
          status: transportError?.status,
        });
        toast.error("Não foi possível processar a devolução. Tente novamente.");
        return;
      }

      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        (data as Record<string, unknown>).ok === false
      ) {
        const reason = (data as Record<string, unknown>).reason;

        if (reason === "invalid_session") {
          toast.error("Sessão expirada. Entre novamente.");
          invalidateAsyncWork();
          onLogout();
          return;
        }

        if (reason === "invalid_cash_register") {
          toast.error("Caixa não está mais aberto. Reabra o caixa.");
          invalidateAsyncWork();
          onInvalidCash();
          return;
        }

        if (
          reason === "return_quantity_exceeds_available" ||
          reason === "nothing_left_to_refund" ||
          reason === "duplicate_return_item"
        ) {
          clearLoadedOrder();
          toast.error(
            "A quantidade disponível para devolução mudou. Busque o pedido novamente.",
          );
          return;
        }

        if (reason === "order_not_found") {
          clearLoadedOrder();
          toast.error("Pedido não está mais disponível para devolução.");
          return;
        }

        if (
          reason === "invalid_return" ||
          reason === "invalid_return_item" ||
          reason === "invalid_return_quantity" ||
          reason === "item_not_in_order" ||
          reason === "invalid_original_items" ||
          reason === "invalid_original_item" ||
          reason === "invalid_original_price" ||
          reason === "invalid_original_total"
        ) {
          toast.error("Devolução rejeitada. Busque o pedido novamente.");
          return;
        }

        toast.error("Não foi possível processar a devolução. Tente novamente.");
        return;
      }

      const canonicalRefund = parsePdvRefundSuccess(data, order.id);
      if (canonicalRefund === null) {
        toast.error("Resposta inválida ao processar devolução. Tente novamente.");
        return;
      }

      toast.success("Devolução de " + fmt(canonicalRefund) + " registrada");
      closeModal();
    } finally {
      if (
        mountedRef.current &&
        requestId === refundRequestIdRef.current
      ) {
        refundingRef.current = false;
        setLoading(false);
      }
    }
  };

  return (
    <ModalShell title="Devolução de pedido" onClose={closeModal}>
      <div className="flex items-center gap-2">
        <input
          value={orderId}
          onChange={(e) => changeOrderId(e.target.value)}
          disabled={refundingRef.current}
          placeholder="Número/ID do pedido"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 outline-none disabled:opacity-60"
        />
        <button
          onClick={buscar}
          disabled={loading}
          className="touch-btn px-4 py-2 rounded-lg bg-amber-500 text-zinc-950 font-bold text-sm hover:bg-amber-400 disabled:opacity-60"
        >
          {loading && searchingRef.current ? "Buscando..." : "Buscar"}
        </button>
      </div>

      {order && (
        <div className="space-y-2">
          <div className="text-xs text-zinc-400">
            Pedido {order.id.slice(0, 8)} • {order.customer_name || "-"} •{" "}
            <b className="text-amber-400">{fmt(order.total)}</b>
          </div>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {items.map((item) => {
              const max = item.quantity;
              const current = selected[item.product_id] ?? 0;
              return (
                <div
                  key={item.product_id}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 flex items-center gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{item.name}</div>
                    <div className="text-xs text-zinc-500">
                      {fmt(item.price)} × até {max}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleQty(item.product_id, -1, max)}
                    className="w-7 h-7 rounded-md bg-zinc-800"
                  >
                    <Minus className="w-3.5 h-3.5 mx-auto" />
                  </button>
                  <div className="w-6 text-center text-sm font-bold">{current}</div>
                  <button
                    onClick={() => toggleQty(item.product_id, 1, max)}
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
            <b className="text-amber-400">
              {fmt(valorTotal ?? 0)}
            </b>
          </div>
          <button
            disabled={loading}
            onClick={confirmar}
            className="w-full touch-btn rounded-xl bg-amber-500 text-zinc-950 font-bold py-3 hover:bg-amber-400 disabled:opacity-60"
          >
            {loading && refundingRef.current
              ? "Processando devolução..."
              : "Confirmar devolução"}
          </button>
        </div>
      )}
    </ModalShell>
  );
}

type PdvCashSummary = {
  saldo_inicial: number;
  vendas_dinheiro: number;
  vendas_pix: number;
  vendas_cartao: number;
  total_vendas: number;
  sangrias: number;
  suprimentos: number;
  devolucoes: number;
  saldo_final_dinheiro: number;
};

function parsePdvCashSummary(value: unknown): PdvCashSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const payload = value as Record<string, unknown>;
  const saldoInicial = pdvMoneyToSafeCents(payload.saldo_inicial);
  const vendasDinheiro = pdvMoneyToSafeCents(payload.vendas_dinheiro);
  const vendasPix = pdvMoneyToSafeCents(payload.vendas_pix);
  const vendasCartao = pdvMoneyToSafeCents(payload.vendas_cartao);
  const totalVendas = pdvMoneyToSafeCents(payload.total_vendas);
  const sangrias = pdvMoneyToSafeCents(payload.sangrias);
  const suprimentos = pdvMoneyToSafeCents(payload.suprimentos);
  const devolucoes = pdvMoneyToSafeCents(payload.devolucoes);
  const saldoFinalDinheiro = pdvMoneyToSafeCents(payload.saldo_final_dinheiro);

  if (
    saldoInicial === null ||
    vendasDinheiro === null ||
    vendasPix === null ||
    vendasCartao === null ||
    totalVendas === null ||
    sangrias === null ||
    suprimentos === null ||
    devolucoes === null ||
    saldoFinalDinheiro === null
  ) {
    return null;
  }

  return {
    saldo_inicial: saldoInicial / 100,
    vendas_dinheiro: vendasDinheiro / 100,
    vendas_pix: vendasPix / 100,
    vendas_cartao: vendasCartao / 100,
    total_vendas: totalVendas / 100,
    sangrias: sangrias / 100,
    suprimentos: suprimentos / 100,
    devolucoes: devolucoes / 100,
    saldo_final_dinheiro: saldoFinalDinheiro / 100,
  };
}

function FechamentoModal({
  operador,
  sessionToken,
  caixaId,
  onClose,
  onInvalidCash,
  onLogout,
  onClosed,
}: {
  operador: Operador;
  sessionToken: string;
  caixaId: string;
  onClose: () => void;
  onInvalidCash: () => void;
  onLogout: () => void;
  onClosed: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [resumo, setResumo] = useState<PdvCashSummary | null>(null);
  const [confirming, setConfirming] = useState(false);
  const mountedRef = useRef(true);
  const summaryRequestIdRef = useRef(0);
  const closeRequestIdRef = useRef(0);
  const closingRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      summaryRequestIdRef.current += 1;
      closeRequestIdRef.current += 1;
      closingRef.current = false;
    };
  }, []);

  const invalidateAsyncWork = () => {
    summaryRequestIdRef.current += 1;
    closeRequestIdRef.current += 1;
    closingRef.current = false;
  };

  const closeModal = () => {
    invalidateAsyncWork();
    onClose();
  };

  // Pré-visualização autoritativa via movimentos do caixa.
  useEffect(() => {
    const requestId = ++summaryRequestIdRef.current;
    setLoading(true);
    setResumo(null);

    void (async () => {
      try {
        let data: unknown;
        let error: unknown;

        try {
          const result = await pdvRpc.cashSummary(sessionToken, caixaId);
          data = result.data;
          error = result.error;
        } catch (summaryError) {
          if (
            !mountedRef.current ||
            requestId !== summaryRequestIdRef.current
          ) {
            return;
          }

          console.error("[PDV] pdv_caixa_resumo_v2 rejected", summaryError);
          toast.error("Não foi possível carregar o resumo do caixa. Tente novamente.");
          return;
        }

        if (
          !mountedRef.current ||
          requestId !== summaryRequestIdRef.current
        ) {
          return;
        }

        if (error) {
          const transportError = error as any;
          console.error("[PDV] pdv_caixa_resumo_v2 transport error", {
            code: transportError?.code,
            status: transportError?.status,
          });
          toast.error("Não foi possível carregar o resumo do caixa. Tente novamente.");
          return;
        }

        if (!data || typeof data !== "object" || Array.isArray(data)) {
          console.error("[PDV] invalid pdv_caixa_resumo_v2 payload");
          toast.error("Resposta inválida ao carregar resumo do caixa. Tente novamente.");
          return;
        }

        const response = data as Record<string, unknown>;
        if (response.ok !== true) {
          if (response.ok !== false) {
            console.error("[PDV] invalid pdv_caixa_resumo_v2 success flag");
            toast.error("Resposta inválida ao carregar resumo do caixa. Tente novamente.");
            return;
          }

          if (response.reason === "invalid_session") {
            toast.error("Sessão expirada. Entre novamente.");
            invalidateAsyncWork();
            onLogout();
            return;
          }

          if (response.reason === "invalid_cash") {
            toast.error("Caixa não está mais disponível. Reabra o caixa.");
            invalidateAsyncWork();
            onInvalidCash();
            return;
          }

          console.error("[PDV] pdv_caixa_resumo_v2 returned a non-success response");
          toast.error("Não foi possível carregar o resumo do caixa. Tente novamente.");
          return;
        }

        if (typeof response.status !== "string") {
          console.error("[PDV] invalid pdv_caixa_resumo_v2 status");
          toast.error("Resposta inválida ao carregar resumo do caixa. Tente novamente.");
          return;
        }

        const status = response.status.trim().toLowerCase();
        if (status !== "open" && status !== "aberto") {
          toast.error("Caixa não está mais disponível. Reabra o caixa.");
          invalidateAsyncWork();
          onInvalidCash();
          return;
        }

        const parsedSummary = parsePdvCashSummary(response.resumo);
        if (!parsedSummary) {
          console.error("[PDV] invalid pdv_caixa_resumo_v2 summary");
          toast.error("Resposta inválida ao carregar resumo do caixa. Tente novamente.");
          return;
        }

        setResumo(parsedSummary);
      } finally {
        if (
          mountedRef.current &&
          requestId === summaryRequestIdRef.current
        ) {
          setLoading(false);
        }
      }
    })();

    return () => {
      summaryRequestIdRef.current += 1;
    };
  }, [caixaId, sessionToken, onInvalidCash, onLogout]);

  const fechar = async () => {
    if (closingRef.current) return;

    closingRef.current = true;
    const requestId = ++closeRequestIdRef.current;
    setConfirming(true);

    try {
      let data: unknown;
      let error: unknown;

      try {
        const result = await pdvRpc.closeCash(sessionToken, caixaId);
        data = result.data;
        error = result.error;
      } catch (closeError) {
        if (
          !mountedRef.current ||
          requestId !== closeRequestIdRef.current
        ) {
          return;
        }

        console.error("[PDV] pdv_fechar_caixa_v2 rejected", closeError);
        toast.error("Não foi possível fechar o caixa. Tente novamente.");
        return;
      }

      if (
        !mountedRef.current ||
        requestId !== closeRequestIdRef.current
      ) {
        return;
      }

      if (error) {
        const transportError = error as any;
        console.error("[PDV] pdv_fechar_caixa_v2 transport error", {
          code: transportError?.code,
          status: transportError?.status,
        });
        toast.error("Não foi possível fechar o caixa. Tente novamente.");
        return;
      }

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        console.error("[PDV] invalid pdv_fechar_caixa_v2 payload");
        toast.error("Resposta inválida ao fechar caixa. Tente novamente.");
        return;
      }

      const response = data as Record<string, unknown>;
      if (response.ok !== true) {
        if (response.ok !== false) {
          console.error("[PDV] invalid pdv_fechar_caixa_v2 success flag");
          toast.error("Resposta inválida ao fechar caixa. Tente novamente.");
          return;
        }

        if (response.reason === "invalid_session") {
          toast.error("Sessão expirada. Entre novamente.");
          invalidateAsyncWork();
          onLogout();
          return;
        }

        if (response.reason === "invalid_cash") {
          toast.error("Caixa não está mais disponível. Reabra o caixa.");
          invalidateAsyncWork();
          onInvalidCash();
          return;
        }

        console.error("[PDV] pdv_fechar_caixa_v2 returned a non-success response");
        toast.error("Não foi possível fechar o caixa. Tente novamente.");
        return;
      }

      const canonicalSummary = parsePdvCashSummary(response.resumo);
      if (!canonicalSummary) {
        console.error("[PDV] invalid pdv_fechar_caixa_v2 success payload");
        toast.error("Resposta inválida ao fechar caixa. Tente novamente.");
        return;
      }

      toast.success("Caixa fechado");
      invalidateAsyncWork();
      onClosed();
    } finally {
      if (
        mountedRef.current &&
        requestId === closeRequestIdRef.current
      ) {
        closingRef.current = false;
        setConfirming(false);
      }
    }
  };

  const row = (label: string, value: number, accent = false) => (
    <div className="flex justify-between text-sm py-1">
      <span className="text-zinc-400">{label}</span>
      <span className={accent ? "text-amber-400 font-bold" : "text-white"}>{fmt(value)}</span>
    </div>
  );

  return (
    <ModalShell title="Fechamento de Caixa" onClose={closeModal}>
      {loading ? (
        <div className="text-center text-zinc-500 py-6">Carregando resumo…</div>
      ) : !resumo ? (
        <div className="text-center text-zinc-500 py-6">Resumo indisponível.</div>
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

