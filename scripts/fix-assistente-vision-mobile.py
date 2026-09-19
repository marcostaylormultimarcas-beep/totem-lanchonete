from pathlib import Path
p=Path('src/components/admin/AssistenteVisionPanel.tsx')
s=p.read_text()
old='''        <div className="relative flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center">
            <Bot className="w-7 h-7 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-black">Assistente Vision</h2>
              <span className="text-[10px] uppercase font-bold bg-primary/20 text-primary px-2 py-0.5 rounded-full">IA</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Seu consultor de marketing inteligente. Analisamos seus pedidos e sugerimos ações para você crescer.
            </p>
          </div>
          <button onClick={() => setRefreshTick(t => t + 1)} className="touch-btn px-3 py-2 rounded-xl bg-muted hover:bg-muted/70 flex items-center gap-2 text-sm">
            <RefreshCw className="w-4 h-4" /> Atualizar
          </button>
        </div>'''
new='''        <div className="relative flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div className="w-14 h-14 shrink-0 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Bot className="w-7 h-7 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h2 className="text-xl font-black">Assistente Vision</h2>
                <span className="text-[10px] uppercase font-bold bg-primary/20 text-primary px-2 py-0.5 rounded-full">IA</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Seu consultor de marketing inteligente. Analisamos seus pedidos e sugerimos ações para você crescer.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRefreshTick(t => t + 1)}
            disabled={loading}
            className="touch-btn self-stretch sm:self-auto px-3 py-2 rounded-xl bg-muted hover:bg-muted/70 flex items-center justify-center gap-2 text-sm shrink-0 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Analisando…' : 'Atualizar'}
          </button>
        </div>'''
if s.count(old)!=1: raise SystemExit(f'guard failed: expected header once, got {s.count(old)}')
p.write_text(s.replace(old,new,1))
print('Assistente Vision responsive header fixed')
