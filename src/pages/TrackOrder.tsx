import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import OrderTracking from '@/components/kiosk/OrderTracking';
import { supabase } from '@/integrations/supabase/client';

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

  return (
    <div className="min-h-screen bg-background">
      <OrderTracking orderId={orderId} onClose={() => navigate('/')} />
    </div>
  );
};

export default TrackOrder;
