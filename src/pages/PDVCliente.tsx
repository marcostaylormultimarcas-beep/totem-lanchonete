import { useEffect, useState } from "react";
import { Receipt, QrCode, Copy, Check, Loader2 } from "lucide-react";

type CartItem = { id: string; name: string; price: number; quantity: number };
type Payload = {
  storeName: string;
  items: CartItem[];
  subtotal: number;
  desconto: number;
  total: number;
  forma: string;
  pixQrBase64?: string;
  pixCopiaECola?: string;
  pixLoading?: boolean;
};

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const STORAGE_KEY = "pdv_cliente_mirror_v1";

export default function PDVCliente() {
  const [data, setData] = useState<Payload>({
    storeName: "VisionFood",
    items: [],
    subtotal: 0,
    desconto: 0,
    total: 0,
    forma: "dinheiro",
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setData(JSON.parse(raw));
    } catch {}

    const bc = new BroadcastChannel("pdv-cliente");
    bc.onmessage = (ev) => {
      if (ev.data?.type === "update") setData(ev.data.payload);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setData(JSON.parse(e.newValue));
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      bc.close();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Reset estado de "copiado" quando o pix muda
  useEffect(() => {
    setCopied(false);
  }, [data.pixCopiaECola]);

  const isPix = data.forma === "pix" && data.total > 0;
  const hasRealPix = !!data.pixQrBase64 && !!data.pixCopiaECola;
  const fallbackText = `${data.storeName} - Total ${fmt(data.total)}`;
  const copiaECola = data.pixCopiaECola || fallbackText;
  const qrSrc = hasRealPix
    ? `data:image/png;base64,${data.pixQrBase64}`
    : `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(fallbackText)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copiaECola);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  };

  // ====== TELA CHEIA DE PIX (modo balcão) ======
  if (isPix) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
        <header className="px-8 py-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Receipt className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <div className="text-xl font-bold">{data.storeName}</div>
              <div className="text-xs text-zinc-400 uppercase tracking-widest">Pagamento Pix</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-zinc-500 uppercase">Total a pagar</div>
            <div className="text-4xl font-extrabold text-amber-400">{fmt(data.total)}</div>
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-6 py-8">
          <div className="flex items-center gap-2 mb-6 text-amber-400">
            <QrCode className="w-7 h-7" />
            <span className="font-bold uppercase text-lg tracking-[0.3em]">
              Aponte a câmera do seu celular
            </span>
          </div>

          <div className="relative bg-white rounded-3xl p-6 shadow-[0_0_60px_-10px_rgba(245,158,11,0.4)] border-4 border-amber-500/40">
            {data.pixLoading && !hasRealPix ? (
              <div className="w-[420px] h-[420px] sm:w-[520px] sm:h-[520px] flex flex-col items-center justify-center gap-4 text-zinc-700">
                <Loader2 className="w-16 h-16 animate-spin text-amber-500" />
                <span className="text-lg font-bold">Gerando seu Pix…</span>
              </div>
            ) : (
              <img
                src={qrSrc}
                alt="QR Code Pix"
                className="w-[420px] h-[420px] sm:w-[520px] sm:h-[520px] object-contain"
              />
            )}
          </div>

          <button
            onClick={copy}
            disabled={!hasRealPix && copiaECola.length < 20}
            className="mt-8 inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-amber-500 text-zinc-950 font-extrabold text-lg uppercase tracking-wider hover:bg-amber-400 active:scale-95 transition-all disabled:opacity-50 shadow-lg shadow-amber-500/30"
          >
            {copied ? (
              <>
                <Check className="w-6 h-6" /> Copiado!
              </>
            ) : (
              <>
                <Copy className="w-6 h-6" /> Copia e Cola
              </>
            )}
          </button>

          {!hasRealPix && !data.pixLoading && (
            <p className="mt-4 text-xs text-zinc-500 max-w-md text-center">
              QR de demonstração — configure o Mercado Pago no painel para gerar Pix reais.
            </p>
          )}
        </main>
      </div>
    );
  }

  // ====== TELA NORMAL DE PEDIDO ======
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="px-8 py-6 border-b border-zinc-800 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
          <Receipt className="w-7 h-7 text-amber-500" />
        </div>
        <div>
          <div className="text-2xl font-bold">{data.storeName}</div>
          <div className="text-sm text-zinc-400">Seu pedido em tempo real</div>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_420px]">
        <section className="p-8 overflow-y-auto">
          <h2 className="text-xl font-bold mb-4 text-zinc-300">Itens</h2>
          {data.items.length === 0 ? (
            <div className="text-zinc-500 text-lg py-20 text-center">
              Aguardando produtos…
            </div>
          ) : (
            <ul className="space-y-3">
              {data.items.map((it) => (
                <li
                  key={it.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between"
                >
                  <div>
                    <div className="font-semibold text-lg">{it.name}</div>
                    <div className="text-sm text-zinc-400">
                      {it.quantity} × {fmt(it.price)}
                    </div>
                  </div>
                  <div className="text-amber-400 font-bold text-xl">
                    {fmt(it.price * it.quantity)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="bg-zinc-900 border-l border-zinc-800 p-8 flex flex-col">
          <div className="space-y-2 text-base mb-6">
            <div className="flex justify-between text-zinc-400">
              <span>Subtotal</span>
              <span>{fmt(data.subtotal)}</span>
            </div>
            {data.desconto > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Desconto</span>
                <span>- {fmt(data.desconto)}</span>
              </div>
            )}
            <div className="flex justify-between items-end pt-3 border-t border-zinc-800">
              <span className="text-zinc-400">Total</span>
              <span className="text-amber-400 font-extrabold text-4xl">
                {fmt(data.total)}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
