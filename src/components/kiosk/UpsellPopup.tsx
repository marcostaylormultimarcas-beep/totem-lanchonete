import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrgId } from '@/contexts/OrgContext';
import { ComboSettings } from '@/data/store';

interface UpsellPopupProps {
  onAccept: () => void;
  onDecline: () => void;
}

const DEFAULT_COMBO: ComboSettings = { name: 'Batata + Refri', description: 'Batata + Refri', price: 15, emoji: '🍟🥤', image: '' };

const UpsellPopup = ({ onAccept, onDecline }: UpsellPopupProps) => {
  const orgId = useOrgId();
  const [combo, setCombo] = useState<ComboSettings>(DEFAULT_COMBO);

  useEffect(() => {
    if (!orgId) return;
    const fetchCombo = async () => {
      const { data } = await supabase.from('settings').select('combo').eq('organization_id', orgId).maybeSingle();
      if (data?.combo) setCombo(data.combo as unknown as ComboSettings);
    };
    fetchCombo();
  }, [orgId]);


  const isUrl = (s: string) => !!s && (s.startsWith('http') || s.startsWith('/'));

  return (
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-card rounded-3xl border border-border p-8 max-w-sm w-full text-center space-y-6 animate-scale-in">
        {isUrl(combo.image || '') ? (
          <img src={combo.image} alt={combo.name} className="w-32 h-32 mx-auto object-cover rounded-2xl" />
        ) : (
          <div className="text-6xl">{combo.emoji}</div>
        )}
        <h3 className="text-2xl font-bold">Que tal um combo?</h3>
        <p className="text-muted-foreground">
          Adicione <span className="text-primary font-bold">{combo.description}</span> por apenas
        </p>
        <p className="text-4xl font-black text-accent pulse-glow inline-block rounded-2xl px-6 py-2">
          + R$ {combo.price.toFixed(2).replace('.', ',')}
        </p>

        <div className="space-y-3">
          <button
            onClick={onAccept}
            className="touch-btn w-full bg-accent text-accent-foreground py-4 rounded-xl text-lg pulse-glow"
          >
            SIM, EU QUERO! 🔥
          </button>
          <button
            onClick={onDecline}
            className="touch-btn w-full bg-muted text-muted-foreground py-3 rounded-xl"
          >
            Não, obrigado
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpsellPopup;
