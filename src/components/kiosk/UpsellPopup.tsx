import { useState, useEffect } from 'react';
import { X, Lock, Sparkles } from 'lucide-react';
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
    supabase.from('settings').select('combo').eq('organization_id', orgId).maybeSingle()
      .then(({ data }) => { if (data?.combo) setCombo(data.combo as unknown as ComboSettings); });
  }, [orgId]);

  const isUrl = (s: string) => !!s && (s.startsWith('http') || s.startsWith('/'));

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
      onClick={onDecline}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-[90%] max-w-sm overflow-hidden text-center"
        style={{
          background: '#18181B',
          borderRadius: '24px',
          border: '1px solid rgba(255,122,0,0.18)',
          boxShadow: '0 30px 80px -10px rgba(0,0,0,0.7), 0 0 60px -20px rgba(255,122,0,0.35)',
          animation: 'upsellIn 250ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <style>{`@keyframes upsellIn { from { opacity: 0; transform: scale(0.95);} to { opacity: 1; transform: scale(1);} }`}</style>

        {/* Botão fechar */}
        <button
          onClick={onDecline}
          aria-label="Fechar"
          className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-110"
          style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)' }}
        >
          <X className="w-5 h-5 text-white/80" />
        </button>

        {/* Imagem hero com glow laranja */}
        <div
          className="relative w-full pt-8 pb-4 px-6 flex items-center justify-center"
          style={{
            background: 'radial-gradient(ellipse at center top, rgba(255,122,0,0.25) 0%, rgba(24,24,27,0) 70%)',
            minHeight: '260px',
          }}
        >
          {isUrl(combo.image || '') ? (
            <img
              src={combo.image}
              alt={combo.name}
              className="max-h-56 w-auto object-contain drop-shadow-[0_10px_40px_rgba(255,122,0,0.5)]"
            />
          ) : (
            <div className="text-[7rem] leading-none drop-shadow-[0_10px_40px_rgba(255,122,0,0.5)]">
              {combo.emoji}
            </div>
          )}
        </div>

        {/* Conteúdo */}
        <div className="px-7 pb-7 pt-2 space-y-5">
          {/* Selo */}
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold tracking-wider"
            style={{
              background: 'rgba(255,122,0,0.12)',
              border: '1px solid rgba(255,122,0,0.35)',
              color: '#FF7A00',
            }}
          >
            <Sparkles className="w-3.5 h-3.5 fill-current" />
            COMBO ESPECIAL
          </div>

          {/* Título */}
          <h3 className="text-4xl font-black leading-tight" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
            <span className="text-white">Que tal um </span>
            <span style={{ color: '#FF7A00' }}>combo?</span>
          </h3>

          {/* Descrição */}
          <p className="text-base text-white/60 leading-relaxed">
            Adicione <span className="font-bold" style={{ color: '#FF7A00' }}>{combo.description}</span> à sua pizza e aproveite por apenas
          </p>

          {/* Card de preço com glow */}
          <div
            className="relative rounded-2xl py-5 px-6"
            style={{
              background: 'rgba(255,122,0,0.06)',
              border: '1.5px solid rgba(255,122,0,0.4)',
              boxShadow: 'inset 0 0 30px rgba(255,122,0,0.08), 0 0 30px -10px rgba(255,122,0,0.4)',
            }}
          >
            <Sparkles className="absolute -top-2 -right-2 w-5 h-5" style={{ color: '#FFA726' }} />
            <p className="text-4xl font-black" style={{ color: '#FF7A00' }}>
              + R$ {combo.price.toFixed(2).replace('.', ',')}
            </p>
          </div>

          {/* CTA principal */}
          <button
            onClick={onAccept}
            className="w-full py-4 rounded-2xl text-base font-black tracking-wide transition-all active:scale-[0.98] hover:brightness-110 flex items-center justify-center gap-2"
            style={{
              background: 'linear-gradient(135deg, #FF7A00 0%, #FFA726 100%)',
              color: '#1a1a1a',
              boxShadow: '0 10px 30px -5px rgba(255,122,0,0.5), 0 0 40px -10px rgba(255,167,38,0.6)',
            }}
          >
            <Sparkles className="w-4 h-4 fill-current" />
            SIM, EU QUERO! 🔥
          </button>

          {/* Secundário */}
          <button
            onClick={onDecline}
            className="w-full py-2 text-sm font-semibold text-white/50 hover:text-white/80 transition-colors"
          >
            Não, obrigado
          </button>

          {/* Rodapé "adicionar depois" */}
          <div className="flex items-center justify-center gap-2 text-xs text-white/35 pt-1">
            <Lock className="w-3.5 h-3.5" />
            <span>Você pode adicionar depois</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UpsellPopup;
