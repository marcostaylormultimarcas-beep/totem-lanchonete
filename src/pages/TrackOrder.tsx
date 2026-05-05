import { useParams, useNavigate } from 'react-router-dom';
import OrderTracking from '@/components/kiosk/OrderTracking';

const TrackOrder = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();

  if (!orderId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
        <p>Pedido não encontrado.</p>
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
