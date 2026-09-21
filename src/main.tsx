// Bootstrap limpo — sem fallbacks de chave/URL. Tudo vem de import.meta.env (Vite).
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
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
    host.includes("lovable.app") && host.includes("preview") ||
    /^deploy-preview-\d+--.+\.netlify\.app$/i.test(host);
  const isLocalhost = host === "localhost" || host === "127.0.0.1";

  if (isInIframe || isPreviewHost || isLocalhost) {
    // Preview precisa refletir cada commit imediatamente. Service Worker e caches
    // offline ficam restritos ao host de produção para não mascarar o HEAD atual.
    void Promise.all([
      navigator.serviceWorker.getRegistrations().then((regs) =>
        Promise.all(regs.map((registration) => registration.unregister()))
      ),
      "caches" in window
        ? caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        : Promise.resolve([]),
    ]).finally(() => {
      if (!isPreviewHost || !navigator.serviceWorker.controller) return;
      const reloadKey = "vf-preview-sw-reset";
      if (sessionStorage.getItem(reloadKey) === "1") {
        sessionStorage.removeItem(reloadKey);
        return;
      }
      sessionStorage.setItem(reloadKey, "1");
      window.location.reload();
    });
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
