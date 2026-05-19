// Bootstrap limpo — sem fallbacks de chave/URL. Tudo vem de import.meta.env (Vite).
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
