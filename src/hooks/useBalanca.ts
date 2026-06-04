import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook de integração com balança via Web Serial API (cabo USB/Serial).
 *
 * Compatibilidade: navegadores Chromium (Chrome/Edge/TV Box com WebView Chromium).
 * Requer contexto seguro (HTTPS) e permissão do usuário (gesto disparando requestPort).
 *
 * Parser inicial: padrão Toledo/Filizola — extrai apenas dígitos da string recebida
 * (ex: "w000550\r" → 550 → 0.550 kg). Quando a balança envia frames longos com
 * vários números, usamos o trecho com pelo menos 4 dígitos mais próximo do fim.
 */

type Status = 'idle' | 'connecting' | 'connected' | 'error';

interface SerialLike {
  requestPort: (opts?: any) => Promise<any>;
}

export interface UseBalancaResult {
  pesoAtual: number;
  balancaConectada: boolean;
  status: Status;
  error: string;
  supported: boolean;
  conectarBalanca: () => Promise<void>;
  desconectarBalanca: () => Promise<void>;
}

function parsePeso(raw: string): number | null {
  if (!raw) return null;
  // Junta todas as sequências numéricas e pega a maior (>= 4 dígitos preferencialmente)
  const matches = raw.match(/\d{3,7}/g);
  if (!matches || matches.length === 0) return null;
  // Prioriza sequências de 4-6 dígitos (padrão balanças de checkout)
  const candidates = matches.filter(m => m.length >= 4 && m.length <= 6);
  const chosen = candidates.length > 0 ? candidates[candidates.length - 1] : matches[matches.length - 1];
  const grams = parseInt(chosen, 10);
  if (!Number.isFinite(grams)) return null;
  const kg = grams / 1000;
  // Sanidade: balanças de checkout normalmente 0 - 30 kg
  if (kg < 0 || kg > 50) return null;
  return Math.round(kg * 1000) / 1000;
}

export function useBalanca(baudRate = 9600): UseBalancaResult {
  const [pesoAtual, setPesoAtual] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const keepReadingRef = useRef(false);
  const bufferRef = useRef('');

  const serial: SerialLike | null = typeof navigator !== 'undefined' && (navigator as any).serial ? (navigator as any).serial : null;
  const supported = !!serial;

  const stopReader = useCallback(async () => {
    keepReadingRef.current = false;
    try { await readerRef.current?.cancel(); } catch { /* noop */ }
    readerRef.current = null;
  }, []);

  const desconectarBalanca = useCallback(async () => {
    await stopReader();
    try { await portRef.current?.close(); } catch { /* noop */ }
    portRef.current = null;
    setStatus('idle');
  }, [stopReader]);

  const readLoop = useCallback(async (port: any) => {
    const decoder = new TextDecoderStream();
    const readableClosed = port.readable.pipeTo(decoder.writable).catch(() => {});
    const reader = decoder.readable.getReader();
    readerRef.current = reader;
    keepReadingRef.current = true;
    try {
      while (keepReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        bufferRef.current += value;
        // Processa por linhas (CR/LF) ou flush periódico se o buffer cresceu
        const parts = bufferRef.current.split(/[\r\n]+/);
        bufferRef.current = parts.pop() ?? '';
        for (const line of parts) {
          const peso = parsePeso(line);
          if (peso !== null) setPesoAtual(peso);
        }
        if (bufferRef.current.length > 64) {
          const peso = parsePeso(bufferRef.current);
          if (peso !== null) setPesoAtual(peso);
          bufferRef.current = '';
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Falha na leitura da balança (cabo desconectado?)');
      setStatus('error');
    } finally {
      try { reader.releaseLock(); } catch { /* noop */ }
      await readableClosed;
    }
  }, []);

  const conectarBalanca = useCallback(async () => {
    if (!serial) {
      setError('Web Serial não suportada neste navegador. Use Chrome/Edge em HTTPS.');
      setStatus('error');
      return;
    }
    try {
      setError('');
      setStatus('connecting');
      const port = await serial.requestPort();
      await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
      portRef.current = port;
      setStatus('connected');
      readLoop(port).catch(() => { /* tratado no loop */ });
    } catch (err: any) {
      const msg = err?.message || String(err);
      // Cancelamento do diálogo de seleção não é um erro real
      if (/cancel/i.test(msg) || err?.name === 'NotFoundError') {
        setStatus('idle');
        return;
      }
      setError(msg);
      setStatus('error');
    }
  }, [serial, baudRate, readLoop]);

  // Detecta desconexão física (evento disconnect da Web Serial)
  useEffect(() => {
    if (!serial) return;
    const onDisconnect = (e: any) => {
      if (portRef.current && e?.target === portRef.current) {
        setError('Cabo da balança desconectado.');
        setStatus('idle');
        portRef.current = null;
      }
    };
    (serial as any).addEventListener?.('disconnect', onDisconnect);
    return () => (serial as any).removeEventListener?.('disconnect', onDisconnect);
  }, [serial]);

  // Cleanup ao desmontar
  useEffect(() => {
    return () => { desconectarBalanca(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    pesoAtual,
    balancaConectada: status === 'connected',
    status,
    error,
    supported,
    conectarBalanca,
    desconectarBalanca,
  };
}
