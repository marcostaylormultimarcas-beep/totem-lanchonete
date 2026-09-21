import { lazy, Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OrgProvider, KioskSlugSync } from "@/contexts/OrgContext";
import SupportChat from "@/components/support/SupportChat";
import Auth from "./pages/Auth.tsx";
import OrderHistory from "./pages/OrderHistory.tsx";

const Index = lazy(() => import("./pages/Index.tsx"));
const Login = lazy(() => import("./pages/Login.tsx"));
const Home = lazy(() => import("./pages/Home.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Admin = lazy(() => import("./pages/Admin.tsx"));
const TrackOrder = lazy(() => import("./pages/TrackOrder.tsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));
const FiscalReceipt = lazy(() => import("./pages/FiscalReceipt.tsx"));
const EntregadorLogin = lazy(() => import("./pages/EntregadorLogin.tsx"));
const EntregadorDashboard = lazy(() => import("./pages/EntregadorDashboard.tsx"));
const VisionPrime = lazy(() => import("./pages/VisionPrime.tsx"));
const ClubeVantagens = lazy(() => import("./pages/ClubeVantagens.tsx"));
const Onboarding = lazy(() => import("./pages/Onboarding.tsx"));
const PainelSenhas = lazy(() => import("./pages/PainelSenhas.tsx"));
const PDV = lazy(() => import("./pages/PDV.tsx"));
const PDVCliente = lazy(() => import("./pages/PDVCliente.tsx"));

const APP_VERSION = "1.0.2";

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    const savedVersion = localStorage.getItem("app_version");
    if (savedVersion && savedVersion !== APP_VERSION) {
      localStorage.setItem("app_version", APP_VERSION);
      window.location.reload();
      return;
    }
    if (!savedVersion) {
      localStorage.setItem("app_version", APP_VERSION);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <OrgProvider>
            <Suspense
              fallback={
                <div className="min-h-screen bg-background flex items-center justify-center px-6" aria-busy="true">
                  <div className="text-center space-y-3">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-sm text-muted-foreground">Carregando...</p>
                  </div>
                </div>
              }
            >
              <Routes>
                {/* Página principal pública: cardápio da lanchonete */}
                <Route path="/" element={<Index />} />
                {/* Rota oculta de login administrativo */}
                <Route path="/gerencia-vision-x" element={<Login />} />
                {/* Rotas antigas de login redirecionam para a raiz pública */}
                <Route path="/login" element={<Navigate to="/" replace />} />
                {/* Loja pública: abre direto o cardápio/totem quando o slug existir */}
                <Route path="/loja/:slug" element={<KioskSlugSync><Index /></KioskSlugSync>} />
                {/* Landing institucional só fica no /home */}
                <Route path="/loja/:slug/home" element={<Home />} />
                {/* Totem público (kiosk de autoatendimento) */}
                <Route path="/cardapio/:slug" element={<KioskSlugSync><Index /></KioskSlugSync>} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/meus-pedidos" element={<OrderHistory />} />
                <Route path="/acompanhar/:orderId" element={<TrackOrder />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/fiscal/:orderId" element={<FiscalReceipt />} />
                <Route path="/entregador/login" element={<EntregadorLogin />} />
                <Route path="/entregador/login/:slug" element={<EntregadorLogin />} />
                <Route path="/entregador" element={<EntregadorDashboard />} />
                <Route path="/loja/:slug/prime" element={<KioskSlugSync><VisionPrime /></KioskSlugSync>} />
                <Route path="/cardapio/:slug/prime" element={<KioskSlugSync><VisionPrime /></KioskSlugSync>} />
                <Route path="/clube" element={<ClubeVantagens />} />
                <Route path="/loja/:slug/clube" element={<KioskSlugSync><ClubeVantagens /></KioskSlugSync>} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/painel-senhas/:slug" element={<PainelSenhas />} />
                <Route path="/pdv" element={<PDV />} />
                <Route path="/pdv/:slug" element={<PDV />} />
                <Route path="/pdv-cliente" element={<PDVCliente />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            <SupportChat />
          </OrgProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
