import { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { ArrowRight } from 'lucide-react';
import primeImg from '@/assets/superapp-prime.jpg';
import iaImg from '@/assets/superapp-ia.jpg';
import comktImg from '@/assets/superapp-comarketing.jpg';
import autonomiaImg from '@/assets/superapp-autonomia.jpg';
import logImg from '@/assets/superapp-logistica.jpg';
import opImg from '@/assets/superapp-operacao.jpg';
import { BRAND_NAME } from '@/config/brandConfig';

type Slide = {
  tag: string;
  title: string;
  desc: string;
  icon: string; // Font Awesome class
  img: string;
  alt: string;
  highlight?: boolean;
  bullets?: string[];
};

const SLIDES: Slide[] = [
  {
    tag: 'Vision Prime',
    title: 'Clube de assinatura com selo Elite',
    desc: 'Transforme seus melhores clientes em assinantes recorrentes. Receita previsível mês a mês, badge dourado exclusivo no app e benefícios automáticos.',
    icon: 'fa-solid fa-crown',
    img: primeImg,
    alt: 'Selo premium dourado representando o Vision Prime',
    bullets: ['Receita recorrente', 'Badge Elite no perfil', 'Frete grátis & cashback'],
  },
  {
    tag: 'Assistente Vision IA',
    title: 'IA que analisa seus dados e sugere ações',
    desc: 'O Assistente Vision lê seu histórico de vendas, identifica oportunidades e gera campanhas prontas. Você só aprova com 1 clique — o disparo é nativo.',
    icon: 'fa-solid fa-brain',
    img: iaImg,
    alt: 'Inteligência artificial analisando dados de vendas em tempo real',
    bullets: ['Análise automática de clientes', 'Sugestões em 1 clique', 'Aprenda com cada decisão'],
  },
  {
    tag: 'Co-Marketing Hub',
    title: 'Efeito de rede entre lojas parceiras',
    desc: 'Conecte sua loja a parceiros estratégicos. Cada pedido finalizado gera cupons cruzados, multiplicando a base de clientes sem gastar com mídia.',
    icon: 'fa-solid fa-handshake-angle',
    img: comktImg,
    alt: 'Rede de lojas parceiras trocando cupons em tempo real',
    bullets: ['Cupons cruzados automáticos', 'Crescimento por rede', 'Zero custo de aquisição'],
  },
  {
    tag: 'Autonomia Casa Própria',
    title: 'Infraestrutura nativa de notificações',
    desc: `Sem depender de WhatsApp de terceiros nem de APIs pagas. O ${BRAND_NAME} entrega cada aviso pelo nosso próprio canal: Push do navegador/PWA e Central Interna (sininho) dentro do app do cliente.`,
    icon: 'fa-solid fa-shield-halved',
    img: autonomiaImg,
    alt: 'Servidor próprio com sino de notificações e trilhas de luz laranja',
    highlight: true,
    bullets: [
      'Push nativo (PWA + browser)',
      'Central interna com badge',
      'Zero dependência de WhatsApp',
    ],
  },
];

const OP_BENEFITS = [
  {
    icon: 'fa-regular fa-clock',
    title: 'Horários Dinâmicos',
    desc: 'Janelas por dia, pausas para almoço e botão "Fechar Agora" para emergências.',
  },
  {
    icon: 'fa-solid fa-route',
    title: 'Logística Realtime',
    desc: 'Atribuição manual ou disputa em tempo real, taxa por bairro e código de entrega.',
  },
  {
    icon: 'fa-solid fa-bolt',
    title: 'Estabilidade 24/7',
    desc: 'Realtime nativo, cache-busting automático e infra própria — sempre no ar.',
  },
];

const SuperAppCarousel = () => {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: 'start', dragFree: false });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const scrollTo = useCallback((i: number) => emblaApi?.scrollTo(i), [emblaApi]);
  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelectedIndex(emblaApi.selectedScrollSnap());
    emblaApi.on('select', onSelect);
    onSelect();
    return () => { emblaApi.off('select', onSelect); };
  }, [emblaApi]);

  // Auto-play (pauses on hover via embla's built-in pointer behavior)
  useEffect(() => {
    if (!emblaApi) return;
    const id = setInterval(() => emblaApi.scrollNext(), 7000);
    return () => clearInterval(id);
  }, [emblaApi]);

  return (
    <section
      id="superapp"
      className="font-urbanist py-16 md:py-24 border-t border-orange/10 bg-[#050505] relative overflow-hidden"
      style={{ fontFamily: "'Urbanist', system-ui, sans-serif" }}
    >
      {/* Ambient glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] bg-[#FF6B00]/[0.08] rounded-full blur-3xl pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(255,107,0,0.06),transparent_40%),radial-gradient(circle_at_80%_90%,rgba(255,107,0,0.04),transparent_40%)] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-5 relative">
        {/* Header */}
        <div data-reveal className="text-center max-w-3xl mx-auto mb-10 md:mb-14">
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#FF6B00] px-3.5 py-2 rounded-full bg-[#FF6B00]/10 border border-[#FF6B00]/30">
            <i className="fa-solid fa-bolt-lightning text-[10px]" /> Plataforma Elite {BRAND_NAME}
          </span>
          <h2 className="mt-5 text-3xl md:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.05]">
            Inovações que substituem<br className="hidden md:block" />
            <span className="text-[#FF6B00]"> 5 ferramentas</span> diferentes
          </h2>
          <p className="mt-5 text-white/60 text-base md:text-lg leading-relaxed">
            Uma vitrine das funcionalidades que tornam o {BRAND_NAME} a única infraestrutura de delivery que sua lanchonete realmente precisa.
          </p>
        </div>

        {/* Carousel */}
        <div className="relative">
          <div className="overflow-hidden rounded-3xl" ref={emblaRef}>
            <div className="flex touch-pan-y">
              {SLIDES.map((s, i) => (
                <div key={i} className="flex-[0_0_100%] min-w-0 px-1 md:px-2">
                  <article
                    className={`grid md:grid-cols-2 gap-6 md:gap-10 items-center rounded-3xl p-5 md:p-10 border ${
                      s.highlight
                        ? 'border-[#FF6B00]/60 bg-gradient-to-br from-[#1a0a00] via-black to-[#FF6B00]/10 shadow-[0_0_80px_-15px_rgba(255,107,0,0.55)]'
                        : 'border-white/10 bg-gradient-to-br from-[#0a0a0a] via-black to-[#FF6B00]/[0.04] shadow-[0_0_60px_-20px_rgba(255,107,0,0.3)]'
                    }`}
                  >
                    {/* Image */}
                    <div className="relative aspect-[4/3] md:aspect-[5/4] rounded-2xl overflow-hidden border border-white/10 group">
                      <img
                        src={s.img}
                        alt={s.alt}
                        width={1280}
                        height={960}
                        loading="lazy"
                        draggable={false}
                        className="w-full h-full object-cover select-none transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-tr from-black/70 via-transparent to-[#FF6B00]/10" />
                      {s.highlight && (
                        <span className="absolute top-3 right-3 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-black px-2.5 py-1 bg-[#FF6B00] rounded-md shadow-lg">
                          <i className="fa-solid fa-star text-[9px]" /> Destaque
                        </span>
                      )}
                      <span className="absolute bottom-3 left-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#FF6B00] px-3 py-1.5 bg-black/80 backdrop-blur rounded-md border border-[#FF6B00]/40">
                        <i className={`${s.icon} text-xs`} /> {s.tag}
                      </span>
                    </div>

                    {/* Content */}
                    <div>
                      <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#FF6B00]">
                        <span className="inline-block w-6 h-px bg-[#FF6B00]" />
                        Inovação {String(i + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
                      </div>
                      <h3 className="mt-3 text-2xl md:text-4xl font-black text-white leading-[1.1] tracking-tight">
                        {s.title}
                      </h3>
                      <p className="mt-4 text-white/65 text-base md:text-lg leading-relaxed">
                        {s.desc}
                      </p>
                      {s.bullets && (
                        <ul className="mt-5 space-y-2.5">
                          {s.bullets.map((b, j) => (
                            <li key={j} className="flex items-center gap-3 text-white/80 text-sm md:text-base">
                              <span className="w-5 h-5 rounded-full bg-[#FF6B00]/20 border border-[#FF6B00]/40 flex items-center justify-center shrink-0">
                                <i className="fa-solid fa-check text-[10px] text-[#FF6B00]" />
                              </span>
                              {b}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </article>
                </div>
              ))}
            </div>
          </div>

          {/* Arrows (desktop) */}
          <button
            onClick={scrollPrev}
            aria-label="Slide anterior"
            className="hidden md:flex absolute -left-2 lg:-left-6 top-1/2 -translate-y-1/2 w-12 h-12 items-center justify-center rounded-full bg-black border border-[#FF6B00]/40 text-[#FF6B00] hover:bg-[#FF6B00] hover:text-black transition-all shadow-xl"
          >
            <i className="fa-solid fa-chevron-left" />
          </button>
          <button
            onClick={scrollNext}
            aria-label="Próximo slide"
            className="hidden md:flex absolute -right-2 lg:-right-6 top-1/2 -translate-y-1/2 w-12 h-12 items-center justify-center rounded-full bg-black border border-[#FF6B00]/40 text-[#FF6B00] hover:bg-[#FF6B00] hover:text-black transition-all shadow-xl"
          >
            <i className="fa-solid fa-chevron-right" />
          </button>
        </div>

        {/* Dots */}
        <div className="flex justify-center items-center gap-2 mt-6">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => scrollTo(i)}
              aria-label={`Ir para slide ${i + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === selectedIndex ? 'w-10 bg-[#FF6B00]' : 'w-2 bg-white/20 hover:bg-white/40'
              }`}
            />
          ))}
        </div>

        {/* Operational stability strip */}
        <div className="mt-14 md:mt-20">
          <div className="text-center mb-6">
            <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
              <i className="fa-solid fa-server text-[10px] text-[#FF6B00]" />
              Estabilidade Operacional
            </span>
            <h3 className="mt-2 text-xl md:text-2xl font-black text-white">
              Sua operação no ar, com previsibilidade total
            </h3>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {OP_BENEFITS.map((b) => (
              <div
                key={b.title}
                className="group p-5 rounded-2xl border border-white/10 bg-white/[0.02] hover:border-[#FF6B00]/40 hover:bg-[#FF6B00]/[0.04] transition-all"
              >
                <div className="w-11 h-11 rounded-xl bg-[#FF6B00]/15 border border-[#FF6B00]/30 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <i className={`${b.icon} text-[#FF6B00] text-lg`} />
                </div>
                <h4 className="text-white font-bold text-base">{b.title}</h4>
                <p className="text-white/55 text-sm mt-1 leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-12 md:mt-16">
          <a
            href="#contato"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-[#FF6B00] text-black font-black text-base md:text-lg shadow-[0_0_50px_rgba(255,107,0,0.55)] hover:scale-105 hover:shadow-[0_0_70px_rgba(255,107,0,0.75)] transition-all"
          >
            Quero o {BRAND_NAME} na minha lanchonete <ArrowRight className="w-5 h-5" />
          </a>
          <p className="mt-3 text-xs text-white/40 uppercase tracking-widest">
            <i className="fa-solid fa-lock text-[10px] mr-1" /> Infra própria · Sem APIs externas · Push nativo
          </p>
        </div>
      </div>
    </section>
  );
};

export default SuperAppCarousel;
