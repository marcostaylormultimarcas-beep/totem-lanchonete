// Bootstrap limpo — sem fallbacks de chave/URL. Tudo vem de import.meta.env (Vite).
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// === PWA Service Worker ===
// Registra apenas em produção e fora de iframes/preview do Lovable, para
// não interferir no editor. Estratégia network-first (ver public/sw.js).
(() => {
  if (!("serviceWorker" in navigator)) return;

  const isInIframe = (() => {
    try { return window.self !== window.top; } catch { return true; }
  })();
  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host.includes("lovable.app") && host.includes("preview");
  const isLocalhost = host === "localhost" || host === "127.0.0.1";

  if (isInIframe || isPreviewHost || isLocalhost) {
    // Limpa qualquer SW antigo registrado em ambientes de preview
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    }).catch(() => {});
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // Força checagem de atualização ao voltar online
        const checkUpdate = () => reg.update().catch(() => {});
        window.addEventListener("online", checkUpdate);
        setInterval(checkUpdate, 60_000);
      })
      .catch(() => {});
  });
})();
