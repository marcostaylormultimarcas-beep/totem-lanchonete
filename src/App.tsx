import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Login from "./pages/Login.tsx";
import Home from "./pages/Home.tsx";
import NotFound from "./pages/NotFound.tsx";
import Admin from "./pages/Admin.tsx";
import Auth from "./pages/Auth.tsx";
import OrderHistory from "./pages/OrderHistory.tsx";
import TrackOrder from "./pages/TrackOrder.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import FiscalReceipt from "./pages/FiscalReceipt.tsx";
import EntregadorLogin from "./pages/EntregadorLogin.tsx";
import EntregadorDashboard from "./pages/EntregadorDashboard.tsx";
import { OrgProvider, KioskSlugSync } from "@/contexts/OrgContext";
import SupportChat from "@/components/support/SupportChat";

const APP_VERSION = "1.0.1";

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
            <Routes>
              <Route path="/" element={<Login />} />
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
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            <SupportChat />
          </OrgProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
