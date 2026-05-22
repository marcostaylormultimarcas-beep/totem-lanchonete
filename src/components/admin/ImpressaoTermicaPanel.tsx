import { useEffect, useState } from 'react';
import { Printer, Save, Loader2, RotateCcw, Copy, CheckCircle2, AlertCircle, Download, Wifi, Zap, Send, ListTree } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { BRAND_NAME } from '@/config/brandConfig';

interface Props { organizationId: string | null; }

interface PrintConfig {
  id?: string;
  enabled: boolean;
  auto_print: boolean;
  printer_ip: string;
  printer_port: number;
  paper_width: number;
  agent_token: string;
  last_seen_at: string | null;
  webhook_alerta_url: string;
}

interface LogRow {
  id: string;
  status: string;
  message: string;
  printer_ip: string;
  created_at: string;
}


const ImpressaoTermicaPanel = ({ organizationId }: Props) => {
  const [cfg, setCfg] = useState<PrintConfig>({
    enabled: true, auto_print: true, printer_ip: '', printer_port: 9100,
    paper_width: 48, agent_token: '', last_seen_at: null, webhook_alerta_url: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [logs, setLogs] = useState<LogRow[]>([]);


  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    const { data } = await supabase
      .from('configuracoes_impressao')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (data) setCfg(data as any);
    else {
      // create row to get token
      const { data: created } = await supabase
        .from('configuracoes_impressao')
        .insert({ organization_id: organizationId })
        .select('*').single();
      if (created) setCfg(created as any);
    }
    const { count } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .in('print_status', ['queued', 'pendente_impressao', 'printing']);
    setPendingCount(count || 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, [organizationId]);

  const save = async () => {
    if (!organizationId) return;
    setSaving(true);
    const { error } = await supabase
      .from('configuracoes_impressao')
      .update({
        enabled: cfg.enabled,
        auto_print: cfg.auto_print,
        printer_ip: cfg.printer_ip,
        printer_port: cfg.printer_port,
        paper_width: cfg.paper_width,
      })
      .eq('organization_id', organizationId);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success('Configuração salva');
  };

  const rotateToken = async () => {
    if (!organizationId) return;
    if (!confirm('Gerar um novo token? O agente atual deixará de funcionar até ser reconfigurado.')) return;
    setRotating(true);
    const { data, error } = await supabase.rpc('print_agent_rotate_token', { _org: organizationId });
    setRotating(false);
    if (error || !(data as any)?.ok) { toast.error('Falha ao gerar token'); return; }
    setCfg((c) => ({ ...c, agent_token: (data as any).token }));
    toast.success('Novo token gerado');
  };

  const copyToken = () => {
    navigator.clipboard.writeText(cfg.agent_token);
    toast.success('Token copiado');
  };

  const downloadAgent = () => {
    const projectId = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string) || '';
    const endpoint = `https://${projectId}.functions.supabase.co/print-agent`;
    const script = `// ${BRAND_NAME} — Agente Local de Impressão Térmica
// Requisitos: Node.js 18+ (já tem fetch nativo). Não precisa instalar nada.
// Uso: defina o IP/porta da impressora no painel admin, copie o TOKEN abaixo,
// salve este arquivo como agent.mjs e rode:  node agent.mjs

import net from 'node:net';

const ENDPOINT = '${endpoint}';
const TOKEN    = '${cfg.agent_token}';
const PRINTER_IP   = '${cfg.printer_ip || '192.168.0.100'}';
const PRINTER_PORT = ${cfg.printer_port || 9100};
const POLL_MS = 4000;

const log = (...a) => console.log(new Date().toISOString(), '-', ...a);

async function call(action, body) {
  const r = await fetch(ENDPOINT + '/' + action, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return j;
}

function sendToPrinter(bytes) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(8000);
    socket.once('error', reject);
    socket.once('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      socket.write(bytes, () => socket.end(() => resolve(true)));
    });
  });
}

async function loop() {
  try {
    const auth = await call('auth');
    if (!auth?.ok) { log('AUTH FAIL', auth); return setTimeout(loop, 10000); }
    const res = await call('jobs');
    if (!res?.ok) { log('JOBS FAIL', res); return setTimeout(loop, POLL_MS); }
    const jobs = res.jobs || [];
    if (jobs.length) log('Recebidos', jobs.length, 'pedido(s)');
    for (const job of jobs) {
      try {
        const bytes = Buffer.from(job.escpos_base64, 'base64');
        await sendToPrinter(bytes);
        await call('ack', { order_id: job.order_id, success: true });
        log('Impresso pedido #' + job.order_number);
      } catch (e) {
        log('FALHA pedido #' + job.order_number, e.message);
        await call('ack', { order_id: job.order_id, success: false, error: e.message });
      }
    }
  } catch (e) {
    log('LOOP ERR', e.message);
  }
  setTimeout(loop, POLL_MS);
}

log('${BRAND_NAME} Print Agent iniciado. Impressora ' + PRINTER_IP + ':' + PRINTER_PORT);
loop();
`;
    const blob = new Blob([script], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'visionfood-print-agent.mjs';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  }

  const agentOnline = cfg.last_seen_at && (Date.now() - new Date(cfg.last_seen_at).getTime() < 60_000);

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-2xl p-6 border border-border">
        <div className="flex items-center gap-3 mb-1">
          <Printer className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-bold">Impressão Térmica Automática</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Cada pedido pago é impresso automaticamente na sua impressora térmica via agente local instalado no PC da loja.
        </p>

        <div className="mt-4 flex items-center gap-3 text-sm">
          <div className={`flex items-center gap-1 px-3 py-1 rounded-full ${agentOnline ? 'bg-green-500/15 text-green-500' : 'bg-muted text-muted-foreground'}`}>
            <Wifi className="w-4 h-4" /> Agente {agentOnline ? 'ONLINE' : 'offline'}
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-amber-500/15 text-amber-500">
              <AlertCircle className="w-4 h-4" /> {pendingCount} na fila
            </div>
          )}
          {cfg.last_seen_at && (
            <span className="text-xs text-muted-foreground">
              Último contato: {new Date(cfg.last_seen_at).toLocaleString('pt-BR')}
            </span>
          )}
        </div>
      </div>

      <div className="bg-card rounded-2xl p-6 border border-border space-y-4">
        <h3 className="font-semibold">Configuração da impressora</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-sm font-medium">IP da impressora</span>
            <input
              value={cfg.printer_ip}
              onChange={(e) => setCfg({ ...cfg, printer_ip: e.target.value })}
              placeholder="192.168.0.100"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-input"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Porta</span>
            <input
              type="number"
              value={cfg.printer_port}
              onChange={(e) => setCfg({ ...cfg, printer_port: Number(e.target.value) || 9100 })}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-input"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Largura (caracteres)</span>
            <select
              value={cfg.paper_width}
              onChange={(e) => setCfg({ ...cfg, paper_width: Number(e.target.value) })}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-input"
            >
              <option value={32}>32 (papel 58mm)</option>
              <option value={48}>48 (papel 80mm)</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
            <span className="text-sm">Módulo de impressão ativo</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={cfg.auto_print} onChange={(e) => setCfg({ ...cfg, auto_print: e.target.checked })} />
            <span className="text-sm">Imprimir automaticamente ao receber pedido</span>
          </label>
        </div>

        <button onClick={save} disabled={saving}
          className="touch-btn px-5 py-2.5 rounded-xl bg-primary text-primary-foreground inline-flex items-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar configuração
        </button>
      </div>

      <div className="bg-card rounded-2xl p-6 border border-border space-y-4">
        <h3 className="font-semibold flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-primary" /> Token do agente local</h3>
        <p className="text-sm text-muted-foreground">
          Este token autentica o agente desktop instalado no PC da loja. Mantenha-o seguro — quem tiver acesso pode receber seus pedidos para impressão.
        </p>

        <div className="flex items-center gap-2">
          <input readOnly value={cfg.agent_token}
            className="flex-1 px-3 py-2 rounded-lg bg-background border border-input font-mono text-xs" />
          <button onClick={copyToken} className="touch-btn px-3 py-2 rounded-lg bg-muted hover:bg-muted/70 inline-flex items-center gap-1">
            <Copy className="w-4 h-4" /> Copiar
          </button>
          <button onClick={rotateToken} disabled={rotating}
            className="touch-btn px-3 py-2 rounded-lg bg-muted hover:bg-muted/70 inline-flex items-center gap-1 disabled:opacity-50">
            {rotating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Renovar
          </button>
        </div>
      </div>

      <div className="bg-card rounded-2xl p-6 border border-border space-y-4">
        <h3 className="font-semibold flex items-center gap-2"><Download className="w-5 h-5 text-primary" /> Instalar o agente no PC da loja</h3>
        <ol className="list-decimal list-inside text-sm space-y-2 text-muted-foreground">
          <li>Instale o <strong>Node.js 18 ou superior</strong> no PC onde a impressora está conectada na rede.</li>
          <li>Clique no botão abaixo para baixar o arquivo <code className="px-1.5 py-0.5 bg-muted rounded">visionfood-print-agent.mjs</code> (já vem com o seu token e IP).</li>
          <li>Abra o terminal na pasta do arquivo e rode: <code className="px-1.5 py-0.5 bg-muted rounded">node visionfood-print-agent.mjs</code></li>
          <li>Mantenha essa janela aberta. Você verá os pedidos sendo impressos em tempo real.</li>
          <li>Em caso de falha (impressora desligada/sem rede), o pedido fica com status <strong>pendente_impressao</strong> e você é alertado no painel — basta corrigir e o sistema reimprime sozinho.</li>
        </ol>

        <button onClick={downloadAgent}
          className="touch-btn px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground inline-flex items-center gap-2">
          <Download className="w-4 h-4" /> Baixar agente configurado
        </button>
      </div>
    </div>
  );
};

export default ImpressaoTermicaPanel;
