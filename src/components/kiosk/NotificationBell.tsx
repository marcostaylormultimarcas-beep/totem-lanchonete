import { useEffect, useRef, useState, useCallback } from 'react';
import { Bell, X, Gift, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate, useParams } from 'react-router-dom';

interface Notif {
  id: string;
  organization_id: string;
  customer_phone: string;
  title: string;
  body: string;
  cta_route: string;
  coupon_code: string;
  read_at: string | null;
  clicked_at: string | null;
  created_at: string;
}

const normalize = (s: string) => (s || '').replace(/\D/g, '');

/** Pede permissão e dispara uma notificação nativa (funciona enquanto a aba está aberta) */
async function fireBrowserNotification(title: string, body: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  try {
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico', badge: '/favicon.ico' });
    }
  } catch (_) { /* ignore */ }
}

export const NotificationBell = ({ orgId }: { orgId: string | null }) => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [phone, setPhone] = useState<string>('');
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unread = items.filter(n => !n.read_at).length;

  // Carrega telefone do perfil
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setPhone(''); return; }
      const { data: profile } = await supabase
        .from('profiles').select('phone').eq('user_id', user.id).maybeSingle();
      const p = normalize((profile as any)?.phone || '');
      if (active) setPhone(p);
    })();
    return () => { active = false; };
  }, []);

  const fetchItems = useCallback(async () => {
    if (!phone || !orgId) { setItems([]); return; }
    const { data } = await supabase
      .from('cliente_notificacoes' as any)
      .select('*')
      .eq('organization_id', orgId)
      .eq('customer_phone', phone)
      .order('created_at', { ascending: false })
      .limit(30);
    setItems((data as any as Notif[]) || []);
  }, [phone, orgId]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Realtime — recebe novas notificações em tempo real (sininho + browser push interno)
  useEffect(() => {
    if (!phone || !orgId) return;
    const channel = supabase
      .channel(`notif-${orgId}-${phone}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cliente_notificacoes', filter: `customer_phone=eq.${phone}` },
        (payload) => {
          const n = payload.new as Notif;
          if (n.organization_id !== orgId) return;
          setItems(prev => [n, ...prev].slice(0, 30));
          fireBrowserNotification(n.title, n.body);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [phone, orgId]);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const toggleOpen = async () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) {
      // Pede permissão de notificação no primeiro clique
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch { /* ignore */ }
      }
      // Marca todas como lidas
      const toMark = items.filter(n => !n.read_at).map(n => n.id);
      if (toMark.length) {
        const now = new Date().toISOString();
        await supabase.from('cliente_notificacoes' as any)
          .update({ read_at: now }).in('id', toMark);
        setItems(prev => prev.map(n => toMark.includes(n.id) ? { ...n, read_at: now } : n));
      }
    }
  };

  const handleClick = async (n: Notif) => {
    // log do clique para a IA aprender
    if (!n.clicked_at) {
      const now = new Date().toISOString();
      await supabase.from('cliente_notificacoes' as any).update({ clicked_at: now }).eq('id', n.id);
    }
    // monta destino: se houver cupom, persiste e navega para o cardápio
    if (n.coupon_code) {
      try { localStorage.setItem('pending_coupon', n.coupon_code); } catch { /* ignore */ }
    }
    const fallback = slug ? `/cardapio/${slug}` : '/';
    const target = n.cta_route || fallback;
    setOpen(false);
    navigate(target);
  };

  // Não renderiza o sino se o usuário não tiver telefone cadastrado (não há como entregar)
  if (!phone || !orgId) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleOpen}
        aria-label="Notificações"
        className="relative w-11 h-11 rounded-full bg-card border border-border hover:bg-muted/70 flex items-center justify-center transition"
      >
        <Bell className="w-5 h-5 text-foreground" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-black flex items-center justify-center border-2 border-background">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[320px] max-w-[calc(100vw-24px)] kiosk-card border border-border shadow-2xl z-[80] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
            <h3 className="font-black text-sm flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" /> Notificações
            </h3>
            <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Você ainda não tem notificações.
              </div>
            ) : (
              items.map(n => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-left px-4 py-3 border-b border-border/60 hover:bg-muted/40 transition ${!n.clicked_at ? 'bg-primary/[0.04]' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                      {n.coupon_code ? <Gift className="w-4 h-4 text-primary" /> : <Bell className="w-4 h-4 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold leading-snug">{n.title}</p>
                      {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                      {n.coupon_code && (
                        <span className="inline-block mt-1.5 text-[10px] font-black uppercase bg-primary/15 text-primary px-2 py-0.5 rounded">
                          Cupom: {n.coupon_code}
                        </span>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" /> Toque para abrir
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
