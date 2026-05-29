import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCircle2,
  CreditCard,
  HelpCircle,
  Loader2,
  Rocket,
  Store,
  Upload,
  X,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { CATEGORIAS_LOJA } from '@/lib/categorias';
import { CARDAPIO_TEMPLATES, CardapioTemplateKey, getTemplate } from '@/lib/cardapioTemplates';
import { uploadProductImage } from '@/lib/imageUpload';


const STEPS = [
  { n: 1, label: 'Estabelecimento' },
  { n: 2, label: 'Cardápio' },
  { n: 3, label: 'Notificações' },
  { n: 4, label: 'Pix / Mercado Pago' },
] as const;

const goldText = 'text-amber-300';
const goldBorder = 'border-amber-500/30';
const cardCls = 'bg-zinc-900 border border-amber-500/15 rounded-2xl';
const inputCls =
  'w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 outline-none text-zinc-100 placeholder-zinc-600';

type HelpId = null | 'os_app' | 'os_key' | 'mp_pub' | 'mp_tok' | 'mp_webhook';

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [help, setHelp] = useState<HelpId>(null);

  // step 1
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('lanchonete');
  const [telefone, setTelefone] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');

  // step 2
  const [template, setTemplate] = useState<CardapioTemplateKey | null>(null);

  // step 3
  const [appId, setAppId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [osValidated, setOsValidated] = useState(false);
  const [osError, setOsError] = useState<string>('');
  const [osTesting, setOsTesting] = useState(false);

  // step 4
  const [mpPub, setMpPub] = useState('');
  const [mpTok, setMpTok] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        navigate('/auth');
        return;
      }
      const { data: org } = await supabase
        .from('organizations')
        .select('id, slug, name, categoria, logo_url')
        .eq('owner_id', u.user.id)
        .limit(1)
        .maybeSingle();
      if (org) {
        setOrgId(org.id);
        setOrgSlug(org.slug);
        setNome(org.name || '');
        setCategoria(org.categoria || 'lanchonete');
        setLogoPreview(org.logo_url || '');
        // pré-carrega chaves já salvas da loja (se houver)
        const { data: s } = await supabase
          .from('settings')
          .select('onesignal_app_id, onesignal_api_key, mp_public_key, mp_access_token, whatsapp_number')
          .eq('organization_id', org.id)
          .maybeSingle();
        if (s) {
          setAppId(s.onesignal_app_id || '');
          setApiKey(s.onesignal_api_key || '');
          setMpPub(s.mp_public_key || '');
          setMpTok(s.mp_access_token || '');
          setTelefone(s.whatsapp_number || '');
        }
      }
    })();
  }, [navigate]);

  // Reseta validação quando chaves mudam
  useEffect(() => {
    setOsValidated(false);
    setOsError('');
  }, [appId, apiKey]);

  const webhookUrl = useMemo(() => {
    const ref = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID;
    const base = `https://${ref}.supabase.co/functions/v1/mp-webhook`;
    return orgId ? `${base}?store_id=${orgId}` : base;
  }, [orgId]);

  async function testarOneSignal() {
    if (!appId.trim() || !apiKey.trim()) {
      setOsError('Preencha App ID e REST API Key.');
      toast.error('Preencha App ID e REST API Key.');
      return;
    }
    setOsTesting(true);
    setOsError('');
    try {
      const { data, error } = await supabase.functions.invoke('onesignal-validate', {
        body: { app_id: appId.trim(), api_key: apiKey.trim() },
      });
      if (error) throw error;
      if (data?.valid) {
        setOsValidated(true);
        toast.success('Chaves do OneSignal validadas com sucesso ✅');
      } else {
        setOsValidated(false);
        const msg = data?.error || 'Credenciais inválidas.';
        setOsError(msg);
        toast.error(`OneSignal: ${msg}`);
      }
    } catch (e: any) {
      setOsValidated(false);
      setOsError(e.message || 'Falha ao validar.');
      toast.error('Falha ao validar OneSignal: ' + (e.message || ''));
    } finally {
      setOsTesting(false);
    }
  }


  const onLogo = (f: File | null) => {
    setLogoFile(f);
    if (f) setLogoPreview(URL.createObjectURL(f));
  };

  const canAdvance = () => {
    if (step === 1) return nome.trim().length >= 2 && !!categoria;
    if (step === 2) return !!template;
    if (step === 3) {
      // Se preencheu chaves, exige validação real antes de avançar.
      const filled = appId.trim() || apiKey.trim();
      if (!filled) return true; // pode pular esta etapa
      return osValidated;
    }
    return true;
  };

  const next = async () => {
    if (step === 3 && (appId.trim() || apiKey.trim()) && !osValidated) {
      toast.error('Teste e valide as chaves do OneSignal antes de avançar.');
      return;
    }
    if (!canAdvance()) {
      toast.error('Preencha os campos obrigatórios para continuar.');
      return;
    }
    if (step < 4) {
      setStep(step + 1);
      return;
    }
    await finalizar();
  };


  const back = () => setStep((s) => Math.max(1, s - 1));

  async function ensureOrg(userId: string): Promise<string> {
    if (orgId) return orgId;
    const slug = nome
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || `loja-${Date.now()}`;
    const { data, error } = await supabase
      .from('organizations')
      .insert({ name: nome, slug, categoria, owner_id: userId })
      .select('id, slug')
      .single();
    if (error) throw error;
    setOrgId(data.id);
    setOrgSlug(data.slug);
    return data.id;
  }

  async function finalizar() {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Sessão expirada');
      const oid = await ensureOrg(u.user.id);

      // upload logo
      let logoUrl = logoPreview;
      if (logoFile) {
        logoUrl = await uploadProductImage(logoFile, oid, { kind: 'logo' });
      }

      // org update
      await supabase
        .from('organizations')
        .update({ name: nome, categoria, logo_url: logoUrl || '' })
        .eq('id', oid);

      // settings upsert (telefone + mp)
      const { data: existingSettings } = await supabase
        .from('settings')
        .select('id')
        .eq('organization_id', oid)
        .maybeSingle();
      const settingsPayload: any = {
        organization_id: oid,
        store_name: nome,
        whatsapp_number: telefone,
        mp_public_key: mpPub.trim(),
        mp_access_token: mpTok.trim(),
        pay_pix_enabled: true,
        onesignal_app_id: appId.trim(),
        onesignal_api_key: apiKey.trim(),
      };
      if (existingSettings?.id) {
        await supabase.from('settings').update(settingsPayload).eq('id', existingSettings.id);
      } else {
        await supabase.from('settings').insert(settingsPayload);
      }

      // template products
      if (template) {
        const tpl = getTemplate(template);
        const rows = tpl.produtos.map((p) => ({
          name: p.name,
          price: p.price,
          category: p.category,
          image: p.image,
          description: p.description,
          organization_id: oid,
          available: true,
        }));
        await supabase.from('products').insert(rows);
      }


      // confetes dourados
      const duration = 1800;
      const end = Date.now() + duration;
      const fire = () => {
        confetti({
          particleCount: 6,
          angle: 60,
          spread: 65,
          startVelocity: 55,
          origin: { x: 0, y: 0.7 },
          colors: ['#f59e0b', '#fbbf24', '#fcd34d', '#facc15'],
        });
        confetti({
          particleCount: 6,
          angle: 120,
          spread: 65,
          startVelocity: 55,
          origin: { x: 1, y: 0.7 },
          colors: ['#f59e0b', '#fbbf24', '#fcd34d', '#facc15'],
        });
        if (Date.now() < end) requestAnimationFrame(fire);
      };
      fire();

      setDone(true);
    } catch (e: any) {
      toast.error('Erro ao concluir: ' + (e.message || ''));
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className={`${cardCls} max-w-xl w-full p-8 text-center`}>
          <CheckCircle2 className="w-20 h-20 mx-auto text-amber-400 mb-4" />
          <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
            Seu app está pronto para decolar! 🚀
          </h1>
          <p className="text-zinc-400 mb-8">
            Configuração concluída. Você pode ajustar tudo a qualquer momento no painel.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              onClick={() => navigate('/admin')}
              className="px-5 py-4 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 text-zinc-950 font-bold hover:opacity-90"
            >
              Ir para o Painel Administrativo
            </button>
            <button
              onClick={() => navigate(orgSlug ? `/loja/${orgSlug}` : '/')}
              className="px-5 py-4 rounded-xl border border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
            >
              Visualizar meu Cardápio Online
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
            Configuração Rápida
          </h1>
          <p className="text-zinc-400 text-sm">
            Em menos de 10 minutos seu app estará no ar.
          </p>
        </div>

        {/* Stepper */}
        <div className={`${cardCls} p-4 mb-6`}>
          <div className="flex items-center justify-between gap-2">
            {STEPS.map((s, i) => {
              const active = step === s.n;
              const completed = step > s.n;
              return (
                <div key={s.n} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                        completed
                          ? 'bg-amber-500 text-zinc-950'
                          : active
                          ? 'bg-gradient-to-br from-amber-400 to-yellow-600 text-zinc-950 ring-2 ring-amber-500/40'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {completed ? <CheckCircle2 className="w-5 h-5" /> : s.n}
                    </div>
                    <span
                      className={`text-[10px] sm:text-xs mt-1 ${
                        active ? goldText : 'text-zinc-500'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className={`h-px flex-1 mx-1 ${
                        step > s.n ? 'bg-amber-500' : 'bg-zinc-800'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Conteúdo */}
        <div className={`${cardCls} p-6`}>
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Store className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold">Dados do Estabelecimento</h2>
              </div>
              <div>
                <label className="text-xs text-zinc-400">Nome da Loja *</label>
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className={inputCls}
                  placeholder="Ex: Burger do Zé"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Segmento *</label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className={inputCls}
                >
                  {CATEGORIAS_LOJA.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-400">Telefone / WhatsApp</label>
                <input
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  className={inputCls}
                  placeholder="(11) 99999-9999"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Logo da Loja</label>
                <div className="flex items-center gap-4 mt-1">
                  <div className="w-20 h-20 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-center overflow-hidden">
                    {logoPreview ? (
                      <img src={logoPreview} alt="logo" className="w-full h-full object-cover" />
                    ) : (
                      <Store className="w-8 h-8 text-zinc-700" />
                    )}
                  </div>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="px-4 py-2 rounded-xl border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 inline-flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" /> Enviar logo
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onLogo(e.target.files?.[0] || null)}
                  />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold mb-1">Ativação do Cardápio Inteligente</h2>
                <p className="text-sm text-zinc-400">
                  Para você não começar do zero, escolha um modelo de cardápio para importar
                  automaticamente:
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {CARDAPIO_TEMPLATES.map((t) => {
                  const sel = template === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTemplate(t.key)}
                      className={`p-5 rounded-xl border text-left transition-all ${
                        sel
                          ? 'border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/30'
                          : 'border-zinc-800 bg-zinc-950 hover:border-amber-500/40'
                      }`}
                    >
                      <div className="text-3xl mb-2">{t.icon}</div>
                      <div className="font-bold">{t.label}</div>
                      <div className="text-xs text-zinc-500 mt-1">
                        {t.produtos.length} produtos modelo
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Bell className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold">Integração de Notificações (OneSignal)</h2>
              </div>
              <FieldWithHelp
                label="App ID"
                value={appId}
                onChange={setAppId}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                onHelp={() => setHelp('os_app')}
              />
              <FieldWithHelp
                label="REST API Key"
                value={apiKey}
                onChange={setApiKey}
                placeholder="Sua chave REST"
                type="password"
                onHelp={() => setHelp('os_key')}
              />
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={testarOneSignal}
                  disabled={osTesting || !appId.trim() || !apiKey.trim()}
                  className="px-4 py-2.5 rounded-xl border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-40 inline-flex items-center gap-2 text-sm font-semibold"
                >
                  {osTesting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4" />
                  )}
                  Testar conexão
                </button>
                {osValidated && (
                  <span className="inline-flex items-center gap-1 text-sm text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" /> Validado
                  </span>
                )}
                {osError && (
                  <span className="inline-flex items-center gap-1 text-xs text-rose-400">
                    <AlertTriangle className="w-3.5 h-3.5" /> {osError}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                Pode pular agora e configurar depois em Painel → Notificações Push. Se preencher,
                validamos as chaves diretamente com o OneSignal antes de avançar.
              </p>

            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold">Configuração do Pix (Mercado Pago)</h2>
              </div>
              <FieldWithHelp
                label="Public Key"
                value={mpPub}
                onChange={setMpPub}
                placeholder="APP_USR-..."
                onHelp={() => setHelp('mp_pub')}
              />
              <FieldWithHelp
                label="Access Token"
                value={mpTok}
                onChange={setMpTok}
                placeholder="APP_USR-..."
                type="password"
                onHelp={() => setHelp('mp_tok')}
              />

              <div className="mt-2 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-sm font-semibold text-amber-300">
                    Webhook automático
                  </div>
                  <button
                    onClick={() => setHelp('mp_webhook')}
                    className="text-xs text-amber-300 inline-flex items-center gap-1 hover:underline"
                  >
                    <HelpCircle className="w-3.5 h-3.5" /> Como ativar
                  </button>
                </div>
                <p className="text-xs text-zinc-400 mb-2">
                  Cole esta URL no painel do Mercado Pago em Notificações → Webhooks:
                </p>
                <div className="flex gap-2">
                  <input readOnly value={webhookUrl} className={`${inputCls} font-mono text-xs`} />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl);
                      toast.success('Link copiado!');
                    }}
                    className="px-4 rounded-xl bg-amber-500 text-zinc-950 font-semibold text-sm"
                  >
                    Copiar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Navegação */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={back}
            disabled={step === 1 || saving}
            className="px-5 py-3 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <button
            onClick={next}
            disabled={saving}
            className="flex-1 px-5 py-3 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-600 text-zinc-950 font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-amber-500/20"
          >
            {saving ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : step < 4 ? (
              <>
                Avançar para Próxima Etapa <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                CONCLUIR E DECOLAR MEU APP <Rocket className="w-5 h-5" />
              </>
            )}
          </button>
        </div>
      </div>

      <HelpModal id={help} onClose={() => setHelp(null)} webhookUrl={webhookUrl} />
    </div>
  );
}

function FieldWithHelp({
  label,
  value,
  onChange,
  placeholder,
  type,
  onHelp,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  onHelp: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-zinc-400">{label}</label>
        <button
          onClick={onHelp}
          className="text-[11px] text-amber-300 hover:underline inline-flex items-center gap-1"
        >
          <HelpCircle className="w-3 h-3" /> Ver como pegar essa chave em 1 minuto
        </button>
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type || 'text'}
        className={inputCls + ' font-mono text-sm'}
      />
    </div>
  );
}

function HelpModal({
  id,
  onClose,
  webhookUrl,
}: {
  id: HelpId;
  onClose: () => void;
  webhookUrl: string;
}) {
  if (!id) return null;
  const guides: Record<Exclude<HelpId, null>, { title: string; steps: string[]; link?: string }> = {
    os_app: {
      title: 'Como pegar seu OneSignal App ID',
      steps: [
        'Acesse onesignal.com e faça login.',
        'No menu, abra Settings → Keys & IDs.',
        'Copie o valor de "OneSignal App ID" e cole no campo.',
      ],
      link: 'https://dashboard.onesignal.com/',
    },
    os_key: {
      title: 'Como pegar sua REST API Key (OneSignal)',
      steps: [
        'Em Settings → Keys & IDs, role até "REST API Key".',
        'Clique em "Copy" e cole no campo correspondente.',
        'Essa chave é privada – nunca compartilhe publicamente.',
      ],
      link: 'https://dashboard.onesignal.com/',
    },
    mp_pub: {
      title: 'Como pegar sua Public Key (Mercado Pago)',
      steps: [
        'Acesse o painel do Mercado Pago.',
        'Vá em "Suas integrações" → escolha sua aplicação.',
        'Em "Credenciais de produção", copie a Public Key.',
      ],
      link: 'https://www.mercadopago.com.br/developers/panel',
    },
    mp_tok: {
      title: 'Como pegar seu Access Token (Mercado Pago)',
      steps: [
        'Mesmo painel: "Suas integrações" → sua aplicação.',
        'Em "Credenciais de produção", copie o Access Token.',
        'Esse token é privado – mantenha-o seguro.',
      ],
      link: 'https://www.mercadopago.com.br/developers/panel',
    },
    mp_webhook: {
      title: 'Como ativar o Webhook do Mercado Pago',
      steps: [
        'No painel de desenvolvedor, abra sua aplicação.',
        'Vá em "Notificações" → "Webhooks".',
        `Cole a URL: ${webhookUrl}`,
        'Marque os eventos "payment" e "subscription_preapproval".',
        'Salve. Pronto, pagamentos serão confirmados automaticamente.',
      ],
      link: 'https://www.mercadopago.com.br/developers/panel/notifications/webhooks',
    },
  };
  const g = guides[id];
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-amber-500/30 rounded-2xl max-w-md w-full p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-zinc-400 hover:text-zinc-100"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>
        <h3 className="text-lg font-bold text-amber-300 mb-3">{g.title}</h3>
        <ol className="space-y-2 text-sm text-zinc-300 list-decimal pl-5">
          {g.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {g.link && (
          <a
            href={g.link}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block text-sm text-amber-300 hover:underline"
          >
            Abrir painel oficial →
          </a>
        )}
      </div>
    </div>
  );
}
