import { Component, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL?.trim?.() || import.meta.env.SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;

const FallbackScreen = ({ title, message, hint }: { title: string; message: string; hint?: string }) => (
  <div style={{
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#121212", color: "#f5f5f5", fontFamily: "system-ui, sans-serif", padding: "24px",
  }}>
    <div style={{ maxWidth: 560, textAlign: "center" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: "#f97316", marginBottom: 12 }}>{title}</h1>
      <p style={{ fontSize: 16, lineHeight: 1.5, opacity: 0.9, marginBottom: 16 }}>{message}</p>
      {hint && (
        <pre style={{
          background: "#1e1e1e", padding: 16, borderRadius: 12, textAlign: "left",
          fontSize: 13, overflow: "auto", border: "1px solid #333",
        }}>{hint}</pre>
      )}
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: 20, background: "#f97316", color: "#fff", border: 0,
          padding: "12px 24px", borderRadius: 12, fontWeight: 700, cursor: "pointer", fontSize: 15,
        }}
      >Recarregar</button>
    </div>
  </div>
);

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: any) { console.error("App crash:", error, info); }
  render() {
    if (this.state.error) {
      return (
        <FallbackScreen
          title="Algo deu errado"
          message="Ocorreu um erro inesperado ao carregar o sistema."
          hint={String(this.state.error?.message || this.state.error)}
        />
      );
    }
    return this.props.children;
  }
}

const root = createRoot(document.getElementById("root")!);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  root.render(
    <FallbackScreen
      title="Configuração incompleta"
      message="As variáveis de ambiente do backend não foram configuradas neste deploy. Configure-as no painel da hospedagem (ex.: Netlify → Site settings → Environment variables) e refaça o deploy."
      hint={`VITE_SUPABASE_URL=https://upwstbeimnlgohbqogzz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<sua chave anon>
VITE_SUPABASE_ANON_KEY=<sua chave anon>
VITE_SUPABASE_PROJECT_ID=upwstbeimnlgohbqogzz`}
    />
  );
} else {
  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
