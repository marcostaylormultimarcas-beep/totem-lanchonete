import { useEffect, useState } from "react";
import { Receipt, QrCode } from "lucide-react";

type CartItem = { id: string; name: string; price: number; quantity: number };
type Payload = {
  storeName: string;
  items: CartItem[];
  subtotal: number;
  desconto: number;
  total: number;
  forma: string;
  pixPayload?: string;
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

  const pix = data.pixPayload || `${data.storeName} - Total ${fmt(data.total)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(pix)}`;

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

          {data.forma === "pix" && data.total > 0 && (
            <div className="bg-zinc-950 border border-amber-500/30 rounded-2xl p-5 text-center">
              <div className="flex items-center justify-center gap-2 mb-3 text-amber-400">
                <QrCode className="w-5 h-5" />
                <span className="font-bold uppercase text-sm tracking-wider">
                  Pague com Pix
                </span>
              </div>
              <img
                src={qrUrl}
                alt="QR Code Pix"
                className="w-full max-w-[280px] mx-auto rounded-lg bg-white p-3"
              />
              <p className="mt-3 text-xs text-zinc-500">
                Aponte a câmera do seu celular
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
