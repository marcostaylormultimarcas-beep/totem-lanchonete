import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import OrderTracking from '@/components/kiosk/OrderTracking';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const TrackOrder = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate(`/auth?returnTo=${encodeURIComponent(location.pathname)}`);
      } else {
        setAuthed(true);
      }
      setChecking(false);
    });
  }, [navigate, location.pathname]);

  if (!orderId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
        <p>Pedido não encontrado.</p>
      </div>
    );
  }

  if (checking || !authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success('Você saiu da sua conta.');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex justify-end px-4 pt-4">
        <button
          onClick={handleLogout}
          className="touch-btn flex items-center gap-2 px-4 py-2 rounded-xl bg-muted text-muted-foreground hover:text-foreground text-sm font-semibold"
        >
          <LogOut className="w-4 h-4" /> Sair da conta
        </button>
      </div>
      <OrderTracking orderId={orderId} onClose={() => navigate('/')} />
    </div>
  );
};

export default TrackOrder;
