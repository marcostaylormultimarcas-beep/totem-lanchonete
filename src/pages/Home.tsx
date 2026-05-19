import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  UtensilsCrossed, QrCode, ChefHat, ArrowRight, CheckCircle2, Sparkles,
  Zap, BarChart3, Headphones, X, MessageCircle, Gift, Smartphone, Crown
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import heroTotem from '@/assets/home-hero-totem.jpg';
import cardMenu from '@/assets/home-card-menu.jpg';
import cardPix from '@/assets/home-card-pix.jpg';
import cardKds from '@/assets/home-card-kds.jpg';
import ecosystemImg from '@/assets/home-ecosystem.jpg';

/** URL base do Simulador Interativo (`?modo=demo` ativa isolamento — sem gravar nem alertar KDS). */
const DEFAULT_DEMO_SLUG = 'principal';

/** Fallback de WhatsApp (Super ADM Master) usado sem login ou sem número configurado. */
const DEFAULT_WHATSAPP = '5511999999999';
const normalizeUsername = (value?: string | null) => decodeURIComponent(value || '').trim().toLowerCase();

const toWaLink = (raw?: string | null) => {
  const digits = (raw || '').replace(/\D/g, '');
  const num = digits.length >= 10 ? digits : DEFAULT_WHATSAPP;
  return `https://wa.me/${num}`;
};

/**
 * Resolve WhatsApp:
 *  1. Se houver `:username` na URL → busca a organização por slug e usa o `whatsapp_number` dela.
 *  2. Caso contrário → usa o usuário logado (owner ou master) conforme hierarquia.
 *  3. Fallback final → DEFAULT_WHATSAPP.
 */
const useWhatsappLink = (username?: string) => {
  const [waLink, setWaLink] = useState<string>(toWaLink(null));

  useEffect(() => {
    let cancelled = false;

    const fetchWaFromOrg = async (orgId: string) => {
      const { data: cfg, error } = await supabase
        .from('settings')
        .select('whatsapp_number')
        .eq('organization_id', orgId)
        .maybeSingle();
      if (error) console.warn('[Home/WA] settings error', error);
      return cfg?.whatsapp_number || null;
    };

    const resolveByUsername = async (rawUsername: string) => {
      const slug = normalizeUsername(rawUsername);
      console.log('[Home/WA] resolvendo username:', slug);

      const { data: org, error: orgErr } = await supabase
        .from('organizations')
        .select('id, slug, name')
        .ilike('slug', slug)
        .limit(1)
        .maybeSingle();
      if (orgErr) console.warn('[Home/WA] org by slug error', orgErr);

      if (!org?.id) {
        console.warn('[Home/WA] nenhuma organização encontrada para slug:', slug, '— usando fallback');
        return null;
      }

      const phone = await fetchWaFromOrg(org.id);
      if (!phone) {
        console.warn('[Home/WA] organização encontrada sem whatsapp_number:', org.slug, '— usando fallback');
        return null;
      }
      console.log('[Home/WA] WhatsApp encontrado:', phone, 'para org:', org.slug);
      return phone;
    };

    const resolveByAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const ownedOrg = await supabase.from('organizations').select('id').eq('owner_id', user.id).maybeSingle();
      const [rolesRes, ownedSettingsRes, masterOrgRes] = await Promise.all([
        supabase.from('user_roles' as any).select('role').eq('user_id', user.id),
        ownedOrg.data?.id
          ? supabase.from('settings').select('whatsapp_number').eq('organization_id', ownedOrg.data.id).maybeSingle()
          : Promise.resolve({ data: null } as any),
        supabase.from('organizations').select('id').eq('master_id', user.id).limit(1).maybeSingle(),
      ]);

      const roles = (rolesRes.data || []).map((r: any) => r.role);
      let phone: string | null = ownedSettingsRes.data?.whatsapp_number || null;

      if (!phone && (roles.includes('master_admin') || roles.includes('super_admin')) && masterOrgRes.data?.id) {
        const { data } = await supabase
          .from('settings').select('whatsapp_number')
          .eq('organization_id', masterOrgRes.data.id).maybeSingle();
        phone = data?.whatsapp_number || null;
      }
      return phone;
    };

    const resolveFallback = async () => {
      const { data: org } = await supabase
        .from('organizations').select('id').eq('slug', DEFAULT_DEMO_SLUG).maybeSingle();
      if (!org?.id) return null;
      return fetchWaFromOrg(org.id);
    };

    (async () => {
      try {
        let phone = username
          ? await resolveByUsername(username)
          : await resolveByAuth();
        if (!phone) {
          phone = await resolveFallback();
          console.log('[Home/WA] usando fallback Super ADM:', phone);
        }
        if (!cancelled) setWaLink(toWaLink(phone));
      } catch (e) {
        console.warn('[Home/WA] resolve falhou, usando fallback fixo', e);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async () => {
      if (username) return; // URL com username é determinística
      const phone = await resolveByAuth();
      if (!cancelled) setWaLink(toWaLink(phone));
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [username]);

  return waLink;
};

/** Reveal-on-scroll hook. */
const useReveal = () => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = root.querySelectorAll<HTMLElement>('[data-reveal]');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('reveal-in'); io.unobserve(e.target); }
      }),
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
};

const Home = () => {
  const ref = useReveal();
  const { slug: rawSlug } = useParams<{ slug?: string }>();
  const username = normalizeUsername(rawSlug) || undefined;
  const waLink = useWhatsappLink(username);
  const demoUrl = `/cardapio/${username || DEFAULT_DEMO_SLUG}?modo=demo`;
  const landingPath = username ? `/loja/${username}/home` : '/';
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    if (!demoOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDemoOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [demoOpen]);

  return (
    <div ref={ref} className="min-h-screen text-foreground overflow-x-hidden"
      style={{
        background:
          'radial-gradient(1200px 600px at 10% -10%, rgba(255,107,0,0.10), transparent 60%),' +
          'radial-gradient(900px 500px at 110% 10%, rgba(0,200,83,0.08), transparent 60%),' +
          'linear-gradient(180deg, #0a0a0c 0%, #0e0e11 100%)'
      }}
    >
      {/* === Estilos locais === */}
      <style>{`
        [data-reveal]{opacity:0;transform:translateY(28px);transition:opacity .9s ease,transform .9s ease}
        .reveal-in{opacity:1!important;transform:none!important}
        .glass{
          background:linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02));
          backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
          border:1px solid rgba(255,255,255,0.08);
        }
        .glass:hover{border-color:rgba(255,107,0,0.35)}
        .neon-orange{box-shadow:0 0 0 1px rgba(255,107,0,.45), 0 12px 50px -12px rgba(255,107,0,.6)}
        .neon-emerald{box-shadow:0 0 0 1px rgba(0,200,83,.45), 0 12px 50px -12px rgba(0,200,83,.55)}
        .text-orange{color:#FF6B00}
        .bg-orange{background:#FF6B00}
        .text-emerald{color:#00C853}
        .bg-emerald{background:#00C853}
        .brushed{
          background-image:
            repeating-linear-gradient(90deg, rgba(255,255,255,0.012) 0 2px, transparent 2px 4px),
            linear-gradient(180deg,#0c0c0f,#101014);
        }
        .grad-text{
          background:linear-gradient(90deg,#FF6B00,#FFA255 60%,#FF6B00);
          -webkit-background-clip:text;background-clip:text;color:transparent;
        }
      `}</style>

      {/* === NAV === */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-black/50 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link to={landingPath} className="flex items-center gap-2 font-black tracking-tight">
            <span className="w-8 h-8 rounded-lg bg-orange grid place-items-center neon-orange">
              <UtensilsCrossed className="w-4 h-4 text-black" />
            </span>
            <span className="text-white">Vision<span className="text-orange">Mídia</span></span>
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm text-white/70">
            <a href="#recursos" className="hover:text-white transition">Recursos</a>
            <a href="#ecossistema" className="hover:text-white transition">Ecossistema</a>
            <a href="#contato" className="hover:text-white transition">Contato</a>
          </nav>
          <Link to="/" className="text-sm px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-white transition">
            Acessar Painel
          </Link>
        </div>
      </header>

      {/* === 1. HERO === */}
      <section className="relative brushed">
        <div className="max-w-7xl mx-auto px-5 pt-8 pb-10 md:pt-20 md:pb-20 grid lg:grid-cols-2 gap-8 md:gap-12 items-center">
          <div data-reveal>
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-white/5 border border-white/10 text-white/80">
              <Sparkles className="w-3.5 h-3.5 text-orange" />
              Ecossistema completo para Food Service
            </span>
            <h1 className="mt-5 text-4xl md:text-6xl font-black leading-[1.05] text-white">
              O Autoatendimento Inteligente que Transforma sua Lanchonete em uma{' '}
              <span className="grad-text">Máquina de Vendas</span>
            </h1>
            <p className="mt-6 text-lg text-white/70 max-w-xl">
              Reduza filas, elimine erros de pedido e aumente o ticket médio com um
              ecossistema completo, intuitivo e sincronizado em tempo real.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <button type="button" onClick={() => setDemoOpen(true)}
                className="neon-orange bg-orange text-black font-bold px-6 py-4 rounded-xl inline-flex items-center justify-center gap-2 hover:brightness-110 transition">
                Ver Demonstração <ArrowRight className="w-4 h-4" />
              </button>
              <a href={waLink} target="_blank" rel="noreferrer"
                className="bg-white/5 border border-white/10 text-white font-semibold px-6 py-4 rounded-xl hover:bg-white/10 transition inline-flex items-center justify-center gap-2">
                <MessageCircle className="w-4 h-4 text-emerald" /> Falar com Consultor
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-5 text-sm text-white/60">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald" /> Setup em minutos</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald" /> Pix integrado</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald" /> Tempo real</div>
            </div>
          </div>

          {/* Imagem real do totem */}
          <div data-reveal className="relative">
            <div className="relative mx-auto max-w-md">
              <div className="absolute -inset-6 -z-10 bg-orange/30 blur-3xl rounded-full" />
              <img
                src={heroTotem}
                alt="Totem de autoatendimento Vision Mídia com brilho laranja em lanchonete gourmet"
                width={1024} height={1024}
                className="w-full h-auto rounded-3xl border border-white/10 shadow-2xl object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* === 2. RECURSOS (3 CARDS) === */}
      <section id="recursos" className="py-10 md:py-16 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-5">
          <div data-reveal className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald">Recursos Principais</span>
            <h2 className="mt-3 text-3xl md:text-5xl font-black text-white">
              Tudo o que sua operação precisa, em um só lugar
            </h2>
            <p className="mt-4 text-white/60">
              Do toque do cliente no totem até o pedido pronto na cozinha.
            </p>
          </div>

          <div className="mt-8 md:mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
            {[
              {
                icon: <UtensilsCrossed className="w-5 h-5" />,
                tag: 'Para o cliente',
                title: 'Cardápio Digital Inteligente',
                desc: 'Interface fluida com fotos em alta qualidade, categorias inteligentes e seleção de adicionais — feita para converter.',
                img: cardMenu,
                alt: 'Tablet exibindo cardápio digital interativo de hambúrgueres'
              },
              {
                icon: <QrCode className="w-5 h-5" />,
                tag: 'Pagamento',
                title: 'Checkout Ágil com Pix Integrado',
                desc: 'QR Code Pix gerado automaticamente e confirmação instantânea do pedido, sem intermediários e sem fricção.',
                img: cardPix,
                alt: 'Smartphone exibindo tela de pagamento Pix com QR Code'
              },
              {
                icon: <ChefHat className="w-5 h-5" />,
                tag: 'Operação',
                title: 'Painel de Gestão e Cozinha (KDS)',
                desc: 'A cozinha acompanha a fila em tempo real, com colunas organizadas, alertas sonoros e cronômetros de preparo.',
                img: cardKds,
                alt: 'Monitor KDS industrial em cozinha profissional exibindo painel de pedidos'
              },
              {
                icon: <Gift className="w-5 h-5" />,
                tag: 'Retenção',
                title: 'Programa de Fidelidade Integrado',
                desc: 'Faça o seu cliente voltar mais vezes. Crie regras personalizadas de recompensas e aumente a retenção da sua lanchonete sem precisar de cartões de papel ou apps externos.',
                img: cardMenu,
                alt: 'Cliente recebendo recompensas pelo programa de fidelidade digital'
              },
              {
                icon: <Smartphone className="w-5 h-5" />,
                tag: 'Gestão',
                title: 'Controle Total em Tempo Real',
                desc: 'Autonomia total para o lojista. Altere preços, pause produtos esgotados e acompanhe o volume de vendas diretamente do celular ou computador, a qualquer momento.',
                img: cardKds,
                alt: 'Lojista gerenciando vendas em tempo real pelo celular'
              },
            ].map((c, i) => (
              <div key={i} data-reveal className="glass rounded-3xl overflow-hidden group hover:-translate-y-1 transition-all shadow-xl">
                <div className="relative aspect-[4/3] overflow-hidden">
                  <img
                    src={c.img}
                    alt={c.alt}
                    width={1024} height={768} loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                  <span className="absolute top-3 left-3 text-[10px] font-bold uppercase tracking-widest text-emerald px-2 py-1 bg-black/60 backdrop-blur rounded-md border border-emerald/30">
                    {c.tag}
                  </span>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-orange/15 border border-orange/30 text-orange grid place-items-center">
                      {c.icon}
                    </div>
                    <h3 className="text-xl font-bold text-white">{c.title}</h3>
                  </div>
                  <p className="text-white/65 text-sm leading-relaxed">{c.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === 3. ECOSSISTEMA COMPLETO === */}
      <section id="ecossistema" className="py-12 md:py-16 border-t border-white/5 bg-gradient-to-b from-transparent to-black/40">
        <div className="max-w-7xl mx-auto px-5">
          <div data-reveal className="text-center max-w-3xl mx-auto">
            <span className="text-xs font-bold uppercase tracking-widest text-orange">Ecossistema Integrado</span>
            <h2 className="mt-3 text-3xl md:text-5xl font-black text-white">
              Um ecossistema completo e integrado para o seu negócio
            </h2>
            <p className="mt-4 text-white/60">
              Totem, tablet do garçom e painel gerencial sincronizados na mesma plataforma.
            </p>
          </div>

          {/* Ícones de destaques */}
          <div data-reveal className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {[
              { icon: <Zap className="w-6 h-6 text-orange" />, t: 'Sincronização em tempo real', d: 'Pedidos do totem aparecem na cozinha em milissegundos.' },
              { icon: <BarChart3 className="w-6 h-6 text-orange" />, t: 'Relatórios completos', d: 'Acompanhe vendas, ticket médio e fechamento em qualquer lugar.' },
              { icon: <Headphones className="w-6 h-6 text-orange" />, t: 'Suporte especializado', d: 'Time dedicado em food service para ajudar você a vender mais.' },
            ].map((f, i) => (
              <div key={i} className="glass rounded-2xl p-5 text-center">
                <div className="w-12 h-12 mx-auto rounded-xl bg-orange/10 border border-orange/20 grid place-items-center mb-3">
                  {f.icon}
                </div>
                <h3 className="text-white font-bold">{f.t}</h3>
                <p className="text-white/60 text-sm mt-1">{f.d}</p>
              </div>
            ))}
          </div>

          {/* Imagem panorâmica */}
          <div data-reveal className="mt-14 relative max-w-6xl mx-auto">
            <div className="absolute -inset-8 -z-10 bg-gradient-to-r from-orange/20 via-transparent to-emerald/20 blur-3xl rounded-full" />
            <div className="rounded-3xl overflow-hidden border border-white/10 shadow-2xl neon-orange">
              <img
                src={ecosystemImg}
                alt="Totem, tablet e notebook Vision Mídia sincronizados sobre uma bancada de restaurante"
                width={1600} height={800} loading="lazy"
                className="w-full h-auto object-cover"
              />
            </div>
          </div>

          {/* Stats abaixo */}
          <div data-reveal className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-5xl mx-auto">
            {[
              { v: '99.9%', l: 'Disponibilidade' },
              { v: '<200ms', l: 'Sync tempo real' },
              { v: '+40%', l: 'Ticket médio' },
              { v: '-70%', l: 'Filas no balcão' },
            ].map((s, i) => (
              <div key={i} className="glass rounded-2xl p-5 text-center">
                <div className="text-3xl md:text-4xl font-black grad-text">{s.v}</div>
                <div className="text-xs mt-1 text-white/60 uppercase tracking-wider">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === 4. CTA FINAL === */}
      <section id="contato" className="py-14 md:py-20 border-t border-white/5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange/10 via-transparent to-emerald/10" />
        <div className="max-w-4xl mx-auto px-5 text-center relative" data-reveal>
          <h2 className="text-3xl md:text-5xl font-black">
            <span className="grad-text">Pronto para modernizar o seu atendimento e lucrar mais?</span>
          </h2>
          <p className="mt-5 text-white/70 max-w-2xl mx-auto">
            Junte-se aos restaurantes que já reduziram filas, aumentaram o ticket médio e
            transformaram a operação com a Vision Mídia Digital.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <a href={waLink} target="_blank" rel="noreferrer"
              className="neon-orange bg-orange text-black font-bold px-8 py-5 rounded-xl text-lg inline-flex items-center justify-center gap-2 hover:brightness-110 transition">
              <MessageCircle className="w-5 h-5" /> Falar com Vendedor
            </a>
            <Link to="/"
              className="neon-emerald bg-emerald text-black font-bold px-8 py-5 rounded-xl text-lg inline-flex items-center justify-center gap-2 hover:brightness-110 transition">
              Acessar Painel <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* === 5. FOOTER === */}
      <footer className="border-t border-white/5 py-10">
        <div className="max-w-7xl mx-auto px-5 flex flex-col md:flex-row gap-4 items-center justify-between text-white/50 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-orange grid place-items-center neon-orange">
              <UtensilsCrossed className="w-4 h-4 text-black" />
            </span>
            <span className="font-bold text-white">Vision Mídia Digital</span>
          </div>
          <div>© {new Date().getFullYear()} Vision Mídia · Autoatendimento Inteligente</div>
        </div>
      </footer>

      {/* === MODAL: Simulador Interativo === */}
      {demoOpen && (
        <div
          role="dialog" aria-modal="true" aria-labelledby="demo-title"
          onClick={() => setDemoOpen(false)}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-200"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[440px] flex flex-col"
            style={{ maxHeight: 'calc(100vh - 2rem)' }}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-t-2xl glass border-b border-white/10">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-emerald animate-pulse shrink-0" />
                <h3 id="demo-title" className="text-sm md:text-base font-semibold text-white truncate">
                  Simulador Interativo: Faça um pedido teste
                </h3>
              </div>
              <button
                type="button" onClick={() => setDemoOpen(false)} aria-label="Fechar simulador"
                className="shrink-0 w-9 h-9 rounded-lg bg-white/5 hover:bg-orange hover:text-black border border-white/10 grid place-items-center text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative bg-black rounded-b-2xl overflow-hidden border-x border-b border-white/10 neon-orange">
              <iframe
                src={demoUrl}
                title="Simulador Vision Mídia"
                className="block w-full bg-black"
                style={{ height: 'min(700px, calc(100vh - 8rem))', border: 0 }}
                allow="clipboard-write"
              />
            </div>

            <p className="mt-3 text-center text-xs text-white/50">
              Modo demonstração ativo — nenhum pedido é gravado no sistema real.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
