import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Loader2, Sparkles } from 'lucide-react';

interface Msg { role: 'user' | 'assistant'; content: string }

const FUNCTION_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/support-chat`;

const SupportChat = () => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: 'Olá! 👋 Sou o suporte Vision Tech. Como posso ajudar?' },
  ]);
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setStreaming(true);
    setMessages(m => [...m, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Erro de rede' }));
        setMessages(m => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: `⚠️ ${err.error || 'Não foi possível responder agora.'}` };
          return copy;
        });
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              acc += delta;
              setMessages(m => {
                const copy = [...m];
                copy[copy.length - 1] = { role: 'assistant', content: acc };
                return copy;
              });
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      setMessages(m => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: '⚠️ Erro de conexão. Tente novamente.' };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <>
      {/* Balão flutuante */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir suporte Vision Tech"
          className="fixed bottom-5 right-5 z-[100] group"
        >
          <span className="absolute inset-0 rounded-full bg-primary/40 blur-xl group-hover:bg-primary/60 transition" />
          <span className="relative flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow-2xl border border-primary/40 hover:scale-105 transition">
            <MessageCircle className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-success animate-pulse" />
          </span>
        </button>
      )}

      {/* Painel */}
      {open && (
        <div className="fixed inset-x-3 bottom-3 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[380px] z-[100] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[80vh]">
          <div className="px-4 py-3 bg-gradient-to-r from-primary/20 via-secondary/10 to-transparent border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <p className="text-sm font-bold leading-none">Suporte Vision Tech</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">IA · responde 24/7</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-background/40">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap leading-snug ${
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-muted text-foreground rounded-bl-sm'
                }`}>
                  {m.content || (streaming && i === messages.length - 1 ? <Loader2 className="w-3 h-3 animate-spin" /> : '')}
                </div>
              </div>
            ))}
          </div>

          <div className="p-2 border-t border-border bg-card flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send(); }}
              placeholder="Pergunte algo…"
              disabled={streaming}
              className="flex-1 px-3 py-2 bg-muted rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
            />
            <button
              onClick={send}
              disabled={streaming || !input.trim()}
              className="px-3 py-2 bg-primary text-primary-foreground rounded-xl disabled:opacity-40 hover:opacity-90 transition flex items-center justify-center"
            >
              {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default SupportChat;
