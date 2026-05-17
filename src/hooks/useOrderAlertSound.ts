import { useEffect, useRef, useState } from 'react';

/**
 * Hook que emite um beep curto via Web Audio API em loop enquanto `active === true`.
 * Retorna { needsUnlock, muted, setMuted, unlock } para a UI controlar o estado.
 */
export function useOrderAlertSound(active: boolean, intervalMs = 4000) {
  const [muted, setMuted] = useState(false);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);

  const ensureCtx = () => {
    if (!ctxRef.current) {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      if (!Ctx) return null;
      ctxRef.current = new Ctx();
    }
    return ctxRef.current;
  };

  const playBeep = () => {
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      setNeedsUnlock(true);
      ctx.resume().catch(() => {});
      return;
    }
    setNeedsUnlock(false);
    const now = ctx.currentTime;
    // Dois bipes curtos (estilo campainha de delivery)
    [0, 0.18].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1100, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.16);
    });
  };

  const unlock = () => {
    const ctx = ensureCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    setNeedsUnlock(false);
    playBeep();
  };

  useEffect(() => {
    if (!active || muted) {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    playBeep();
    timerRef.current = window.setInterval(playBeep, intervalMs);
    return () => { if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, muted, intervalMs]);

  // Auto-unlock no primeiro gesto do usuário
  useEffect(() => {
    if (!needsUnlock) return;
    const handler = () => unlock();
    window.addEventListener('click', handler, { once: true });
    window.addEventListener('touchstart', handler, { once: true });
    window.addEventListener('keydown', handler, { once: true });
    return () => {
      window.removeEventListener('click', handler);
      window.removeEventListener('touchstart', handler);
      window.removeEventListener('keydown', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsUnlock]);

  return { needsUnlock, muted, setMuted, unlock };
}
