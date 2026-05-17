import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, ShieldCheck, Cloud, Smartphone, Monitor, QrCode, ChefHat,
  Printer, UtensilsCrossed, ArrowRight, CheckCircle2, Sparkles,
  Database, Lock, Gauge, Tablet
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

/** Número padrão (Super ADM Master) usado quando ninguém está logado ou sem WhatsApp configurado. */
const DEFAULT_WHATSAPP = '5511999999999';

/** Normaliza um número BR para link wa.me (apenas dígitos). */
const toWaLink = (raw?: string | null) => {
  const digits = (raw || '').replace(/\D/g, '');
  const num = digits.length >= 10 ? digits : DEFAULT_WHATSAPP;
  return `https://wa.me/${num}`;
};

/**
 * Hook: resolve WhatsApp do usuário logado conforme hierarquia de roles.
 * - super_admin / master_admin / admin → pega `settings.whatsapp_number` da org do usuário.
 * - Sem login ou sem número → fallback DEFAULT_WHATSAPP.
 * Executa em paralelo (Promise.all) para responder em milissegundos.
 */
const useWhatsappLink = () => {
  const [waLink, setWaLink] = useState<string>(toWaLink(null));

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const [rolesRes, ownedOrgRes, masterOrgRes] = await Promise.all([
          supabase.from('user_roles' as any).select('role').eq('user_id', user.id),
          supabase.from('settings').select('whatsapp_number').eq('organization_id',
            (await supabase.from('organizations').select('id').eq('owner_id', user.id).maybeSingle()).data?.id || ''
          ).maybeSingle(),
          supabase.from('organizations').select('id').eq('master_id', user.id).limit(1).maybeSingle(),
        ]);

        const roles = (rolesRes.data || []).map((r: any) => r.role);
        let phone: string | null = ownedOrgRes.data?.whatsapp_number || null;

        // Master admin sem org própria → tenta uma das orgs que ele gerencia
        if (!phone && (roles.includes('master_admin') || roles.includes('super_admin')) && masterOrgRes.data?.id) {
          const { data } = await supabase
            .from('settings').select('whatsapp_number')
            .eq('organization_id', masterOrgRes.data.id).maybeSingle();
          phone = data?.whatsapp_number || null;
        }

        if (!cancelled && phone) setWaLink(toWaLink(phone));
      } catch (e) {
        console.warn('[Home] WhatsApp resolve falhou, usando fallback', e);
      }
    };

    resolve();

    const { data: sub } = supabase.auth.onAuthStateChange(() => resolve());
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  return waLink;
};

/**
 * Reveal-on-scroll hook (IntersectionObserver) — adiciona classe quando visível.
 */
const useReveal = () => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = root.querySelectorAll<HTMLElement>('[data-reveal]');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('reveal-in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
};

const Home = () => {
  const ref = useReveal();
  const waLink = useWhatsappLink();

  return (
    <div ref={ref} className="min-h-screen bg-[#0b0b0d] text-foreground overflow-x-hidden">
      {/* === Estilos locais (reveal + glow) === */}
      <style>{`
        [data-reveal]{opacity:0;transform:translateY(24px);transition:opacity .8s ease,transform .8s ease}
        .reveal-in{opacity:1!important;transform:none!important}
        .glass{background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015));
               backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
               border:1px solid rgba(255,255,255,0.08)}
        .glass:hover{border-color:rgba(255,122,26,0.35)}
        .grid-bg{
          background-image:
            radial-gradient(circle at 20% 0%, rgba(255,122,26,.18), transparent 40%),
            radial-gradient(circle at 80% 30%, rgba(16,185,129,.12), transparent 45%),
            linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
          background-size: auto, auto, 48px 48px, 48px 48px;
        }
        .neon-orange{box-shadow:0 0 0 1px rgba(255,122,26,.4), 0 10px 40px -10px rgba(255,122,26,.55)}
        .neon-emerald{box-shadow:0 0 0 1px rgba(16,185,129,.45), 0 10px 40px -10px rgba(16,185,129,.5)}
        .text-orange{color:#ff7a1a}
        .bg-orange{background:#ff7a1a}
        .text-emerald{color:#10b981}
        .bg-emerald{background:#10b981}
        .ring-orange{box-shadow:0 0 0 1px rgba(255,122,26,.35)}
      `}</style>

      {/* === NAV === */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-black/40 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link to="/home" className="flex items-center gap-2 font-black tracking-tight">
            <span className="w-8 h-8 rounded-lg bg-orange grid place-items-center">
              <UtensilsCrossed className="w-4 h-4 text-black" />
            </span>
            <span className="text-white">Vision<span className="text-orange">Mídia</span></span>
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm text-white/70">
            <a href="#tecnologia" className="hover:text-white">Tecnologia</a>
            <a href="#ecossistema" className="hover:text-white">Ecossistema</a>
            <a href="#hardware" className="hover:text-white">Hardware</a>
            <a href="#contato" className="hover:text-white">Contato</a>
          </nav>
          <Link to="/" className="text-sm px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-white">
            Acessar Painel
          </Link>
        </div>
      </header>

      {/* === HERO === */}
      <section className="relative grid-bg">
        <div className="max-w-7xl mx-auto px-5 pt-16 pb-24 md:pt-24 md:pb-32 grid lg:grid-cols-2 gap-12 items-center">
          <div data-reveal>
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-white/5 border border-white/10 text-white/80">
              <Sparkles className="w-3.5 h-3.5 text-orange" />
              Ecossistema completo para Food Service
            </span>
            <h1 className="mt-5 text-4xl md:text-6xl font-black leading-[1.05] text-white">
              O Autoatendimento Inteligente que Transforma sua Gestão em uma{' '}
              <span className="text-orange">Máquina de Vendas</span>
            </h1>
            <p className="mt-6 text-lg text-white/70 max-w-xl">
              Reduza filas, elimine erros de pedidos e aumente o faturamento com um
              ecossistema completo, intuitivo e com sincronização instantânea em tempo real.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <a href="#ecossistema"
                className="neon-orange bg-orange text-black font-bold px-6 py-4 rounded-xl inline-flex items-center justify-center gap-2 hover:brightness-110 transition">
                Ver Demonstração <ArrowRight className="w-4 h-4" />
              </a>
              <a href={waLink} target="_blank" rel="noreferrer"
                className="bg-white/5 border border-white/10 text-white font-semibold px-6 py-4 rounded-xl hover:bg-white/10 transition inline-flex items-center justify-center gap-2">
                Falar com Consultor
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-5 text-sm text-white/60">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald" /> Setup em minutos</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald" /> Pix integrado</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald" /> Tempo real</div>
            </div>
          </div>

          {/* Mockup do Totem */}
          <div data-reveal className="relative">
            <div className="relative mx-auto max-w-sm">
              {/* Tela do totem */}
              <div className="rounded-[2rem] bg-gradient-to-b from-zinc-800 to-zinc-950 p-3 border border-white/10 shadow-2xl">
                <div className="rounded-[1.5rem] aspect-[9/16] glass overflow-hidden flex flex-col">
                  <div className="p-4 flex items-center justify-between border-b border-white/5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-orange grid place-items-center">
                        <UtensilsCrossed className="w-3 h-3 text-black" />
                      </div>
                      <span className="text-xs font-bold text-white">Cardápio Digital</span>
                    </div>
                    <span className="text-[10px] text-emerald font-semibold">● ONLINE</span>
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-2 p-3 bg-black/20">
                    {['Burgers', 'Combos', 'Bebidas', 'Sobremesa'].map((n, i) => (
                      <div key={n} className="rounded-xl glass p-3 flex flex-col justify-end aspect-square"
                        style={{ background: `linear-gradient(135deg, rgba(255,122,26,${0.1 + i * 0.05}), rgba(0,0,0,0.6))` }}>
                        <span className="text-xs font-bold text-white">{n}</span>
                        <span className="text-[10px] text-white/60">a partir R$ 19</span>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 border-t border-white/5">
                    <div className="bg-orange text-black text-xs font-bold py-3 rounded-lg text-center">
                      TOQUE PARA INICIAR
                    </div>
                  </div>
                </div>
              </div>
              {/* Base do totem */}
              <div className="mx-auto mt-2 h-8 w-40 bg-gradient-to-b from-zinc-800 to-zinc-950 rounded-b-2xl border border-white/10" />
              <div className="mx-auto h-3 w-56 bg-zinc-900 rounded-b-xl" />
              {/* Glow */}
              <div className="absolute -inset-10 -z-10 bg-orange/20 blur-3xl rounded-full" />
            </div>
          </div>
        </div>
      </section>

      {/* === INFRAESTRUTURA === */}
      <section id="tecnologia" className="py-20 md:py-28 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-5">
          <div data-reveal className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald">Infraestrutura</span>
            <h2 className="mt-3 text-3xl md:text-5xl font-black text-white">
              Tecnologia de ponta para sua operação não parar
            </h2>
            <p className="mt-4 text-white/60">
              Arquitetura moderna, segura e instantânea — pensada para o ritmo do food service.
            </p>
          </div>

          <div className="mt-14 grid md:grid-cols-3 gap-5">
            {[
              {
                icon: <Database className="w-6 h-6 text-orange" />,
                title: 'Sincronização em Tempo Real',
                desc: 'Painel administrativo e banco de dados conversam instantaneamente via Supabase Realtime. Zero delay entre pedido feito e cozinha avisada.'
              },
              {
                icon: <Lock className="w-6 h-6 text-orange" />,
                title: 'Autenticação Segura',
                desc: 'Login integrado para clientes e administradores com criptografia, controle por níveis (super_admin, master_admin, admin) e RLS no banco.'
              },
              {
                icon: <Cloud className="w-6 h-6 text-orange" />,
                title: 'Arquitetura em Nuvem',
                desc: 'Deploy via Netlify com CDN global, carregamento ultra-rápido e 99.9% de disponibilidade. Atualizações automáticas sem downtime.'
              },
            ].map((item, i) => (
              <div key={i} data-reveal className="glass rounded-2xl p-7 transition-all hover:-translate-y-1">
                <div className="w-12 h-12 rounded-xl bg-orange/10 border border-orange/20 grid place-items-center mb-5">
                  {item.icon}
                </div>
                <h3 className="text-xl font-bold text-white">{item.title}</h3>
                <p className="mt-2 text-white/60 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div data-reveal className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { v: '99.9%', l: 'Disponibilidade' },
              { v: '<200ms', l: 'Sync em tempo real' },
              { v: '+40%', l: 'Ticket médio' },
              { v: '-70%', l: 'Filas no balcão' },
            ].map((s, i) => (
              <div key={i} className="glass rounded-2xl p-6 text-center">
                <div className="text-3xl md:text-4xl font-black text-orange">{s.v}</div>
                <div className="text-xs mt-1 text-white/60 uppercase tracking-wider">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === ECOSSISTEMA === */}
      <section id="ecossistema" className="py-20 md:py-28 border-t border-white/5 bg-gradient-to-b from-transparent to-black/30">
        <div className="max-w-7xl mx-auto px-5">
          <div data-reveal className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-bold uppercase tracking-widest text-orange">Ecossistema Completo</span>
            <h2 className="mt-3 text-3xl md:text-5xl font-black text-white">
              Tudo o que você precisa, em um só sistema
            </h2>
            <p className="mt-4 text-white/60">
              Do toque do cliente no totem até o relatório de fechamento do caixa.
            </p>
          </div>

          <div className="mt-14 grid md:grid-cols-2 gap-6">
            {[
              {
                icon: <UtensilsCrossed className="w-6 h-6" />,
                tag: 'Para o cliente',
                title: 'Cardápio Digital Interativo',
                desc: 'Interface fluida para o cliente navegar, escolher adicionais e montar o combo perfeito — com imagens em alta qualidade e categorias inteligentes.'
              },
              {
                icon: <QrCode className="w-6 h-6" />,
                tag: 'Pagamento',
                title: 'Checkout Ágil com Pix Integrado',
                desc: 'Tela de pagamento instantâneo com geração automática de QR Code Pix e confirmação imediata do pedido, sem intermediários.'
              },
              {
                icon: <ChefHat className="w-6 h-6" />,
                tag: 'Operação',
                title: 'Painel de Gestão e Cozinha (KDS)',
                desc: 'Tela gerencial para a cozinha acompanhar a fila de pedidos em tempo real à medida que entram no autoatendimento, com alertas sonoros.'
              },
              {
                icon: <Printer className="w-6 h-6" />,
                tag: 'Gestão',
                title: 'Módulo de Impressão e Relatórios',
                desc: 'Sistema pronto para gerar relatórios, comandas e fechamentos direto em formato digital ou físico (impressora térmica 80mm).'
              },
            ].map((c, i) => (
              <div key={i} data-reveal className="glass rounded-3xl p-7 group hover:-translate-y-1 transition-all">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-xl bg-orange/15 border border-orange/30 text-orange grid place-items-center">
                    {c.icon}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-emerald px-2 py-1 bg-emerald/10 rounded-md border border-emerald/20">
                    {c.tag}
                  </span>
                </div>
                <h3 className="text-2xl font-bold text-white">{c.title}</h3>
                <p className="mt-2 text-white/60 text-sm leading-relaxed">{c.desc}</p>

                {/* Placeholder para print real */}
                <div className="mt-5 aspect-video rounded-xl border border-dashed border-white/15 bg-black/40 grid place-items-center text-white/30 text-xs">
                  [ Espaço para print real do sistema ]
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === HARDWARE === */}
      <section id="hardware" className="py-20 md:py-28 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-5">
          <div data-reveal className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald">Hardware & Integração</span>
            <h2 className="mt-3 text-3xl md:text-5xl font-black text-white">
              Roda perfeitamente em qualquer dispositivo
            </h2>
            <p className="mt-4 text-white/60">
              Solução comercial completa, do totem ao tablet do garçom.
            </p>
          </div>

          <div className="mt-14 grid md:grid-cols-2 gap-6">
            <div data-reveal className="glass rounded-3xl p-8 relative overflow-hidden">
              <div className="absolute -right-10 -top-10 w-48 h-48 bg-orange/20 blur-3xl rounded-full" />
              <Monitor className="w-10 h-10 text-orange" />
              <h3 className="mt-5 text-2xl font-bold text-white">Totens Digitais de Autoatendimento</h3>
              <p className="mt-2 text-white/60">
                Otimizado para salão e balcão, com interface vertical responsiva, áreas de toque
                generosas e fluxo otimizado para conversão.
              </p>
              <ul className="mt-5 space-y-2 text-sm">
                {['Suporte a telas de 21" a 32"', 'Modo kiosk com bloqueio de SO', 'Impressora térmica integrada'].map((t) => (
                  <li key={t} className="flex items-center gap-2 text-white/70">
                    <CheckCircle2 className="w-4 h-4 text-emerald" /> {t}
                  </li>
                ))}
              </ul>
            </div>

            <div data-reveal className="glass rounded-3xl p-8 relative overflow-hidden">
              <div className="absolute -right-10 -top-10 w-48 h-48 bg-emerald/20 blur-3xl rounded-full" />
              <div className="flex gap-2">
                <Smartphone className="w-10 h-10 text-emerald" />
                <Tablet className="w-10 h-10 text-emerald" />
              </div>
              <h3 className="mt-5 text-2xl font-bold text-white">Dispositivos Móveis e Tablets</h3>
              <p className="mt-2 text-white/60">
                Atendimento híbrido: garçons com tablet na mesa, clientes pelo celular via QR Code
                e gestor acompanhando tudo em tempo real.
              </p>
              <ul className="mt-5 space-y-2 text-sm">
                {['100% responsivo (mobile-first)', 'Compatível Android e iOS', 'Funciona em rede local ou 4G'].map((t) => (
                  <li key={t} className="flex items-center gap-2 text-white/70">
                    <CheckCircle2 className="w-4 h-4 text-emerald" /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* === CTA FINAL === */}
      <section id="contato" className="py-20 md:py-32 border-t border-white/5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange/10 via-transparent to-emerald/10" />
        <div className="max-w-4xl mx-auto px-5 text-center relative" data-reveal>
          <Gauge className="w-12 h-12 text-orange mx-auto" />
          <h2 className="mt-6 text-3xl md:text-5xl font-black text-white">
            Pronto para modernizar o seu atendimento e <span className="text-orange">lucrar mais?</span>
          </h2>
          <p className="mt-5 text-white/70 max-w-2xl mx-auto">
            Junte-se aos restaurantes que já reduziram filas, aumentaram o ticket médio e
            transformaram a operação com a Vision Mídia.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <a href="https://wa.me/" target="_blank" rel="noreferrer"
              className="neon-orange bg-orange text-black font-bold px-8 py-5 rounded-xl text-lg inline-flex items-center justify-center gap-2 hover:brightness-110 transition">
              Quero o Sistema na Minha Lanchonete <ArrowRight className="w-5 h-5" />
            </a>
            <Link to="/"
              className="bg-white/5 border border-white/10 text-white font-semibold px-8 py-5 rounded-xl hover:bg-white/10 transition">
              Acessar Painel
            </Link>
          </div>
        </div>
      </section>

      {/* === FOOTER === */}
      <footer className="border-t border-white/5 py-10">
        <div className="max-w-7xl mx-auto px-5 flex flex-col md:flex-row gap-4 items-center justify-between text-white/50 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-md bg-orange grid place-items-center">
              <UtensilsCrossed className="w-3.5 h-3.5 text-black" />
            </span>
            <span className="font-bold text-white">Vision Mídia Digital</span>
          </div>
          <div>© {new Date().getFullYear()} Vision Mídia · Autoatendimento Inteligente</div>
        </div>
      </footer>
    </div>
  );
};

export default Home;
