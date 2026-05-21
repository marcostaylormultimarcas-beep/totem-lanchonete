import { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { ChevronLeft, ChevronRight, Crown, Bot, Handshake, Bike, Clock, ArrowRight } from 'lucide-react';
import primeImg from '@/assets/superapp-prime.jpg';
import iaImg from '@/assets/superapp-ia.jpg';
import comktImg from '@/assets/superapp-comarketing.jpg';
import logImg from '@/assets/superapp-logistica.jpg';
import opImg from '@/assets/superapp-operacao.jpg';

const SLIDES = [
  {
    tag: 'Vision Prime',
    title: 'Clube de Assinatura Premium',
    desc: 'Receita recorrente garantida. Seus melhores clientes pagam uma mensalidade e ganham descontos, frete grátis e um badge dourado exclusivo.',
    icon: <Crown className="w-5 h-5" />,
    img: primeImg,
    alt: 'Coroa premium dourada sobre smartphone com app de assinatura',
  },
  {
    tag: 'IA de Retenção',
    title: 'Recuperação automática via WhatsApp',
    desc: 'A inteligência artificial identifica clientes inativos e dispara mensagens personalizadas no WhatsApp para trazê-los de volta — sem você levantar um dedo.',
    icon: <Bot className="w-5 h-5" />,
    img: iaImg,
    alt: 'Smartphone com WhatsApp e rede neural ao fundo, automação de retenção',
  },
  {
    tag: 'Co-Marketing',
    title: 'Rede de parcerias com cupons cruzados',
    desc: 'Conecte sua loja a outros lojistas da sua cidade. Cada pedido finalizado gera um cupom exclusivo para o cliente usar na loja parceira — e vice-versa.',
    icon: <Handshake className="w-5 h-5" />,
    img: comktImg,
    alt: 'Duas lojas conectadas por rede laranja trocando cupons',
  },
  {
    tag: 'Logística Inteligente',
    title: 'Dashboard do entregador & taxas por bairro',
    desc: 'Atribua pedidos manualmente ou deixe os entregadores disputarem em tempo real. Defina taxa de entrega por bairro e confirme com código de segurança.',
    icon: <Bike className="w-5 h-5" />,
    img: logImg,
    alt: 'Entregador de moto com painel de rota no smartphone à noite',
  },
  {
    tag: 'Gestão de Operação',
    title: 'Horários dinâmicos & fechamento de emergência',
    desc: 'Defina janelas de funcionamento por dia, ative pausas para almoço e tenha um botão de "Fechar Agora" para emergências. O cliente pode até agendar pedidos.',
    icon: <Clock className="w-5 h-5" />,
    img: opImg,
    alt: 'Tablet com dashboard de horários da loja e relógio',
  },
];

const SuperAppCarousel = () => {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: 'start' });
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

  // Auto-play
  useEffect(() => {
    if (!emblaApi) return;
    const id = setInterval(() => emblaApi.scrollNext(), 6000);
    return () => clearInterval(id);
  }, [emblaApi]);

  return (
    <section id="superapp" className="py-12 md:py-20 border-t border-white/5 bg-gradient-to-b from-black/40 via-black/20 to-transparent relative overflow-hidden">
      {/* glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-orange/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-5 relative">
        <div data-reveal className="text-center max-w-3xl mx-auto mb-8 md:mb-12">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-orange px-3 py-1.5 rounded-full bg-orange/10 border border-orange/30">
            <Crown className="w-3.5 h-3.5" /> Super App Vision Mídia
          </span>
          <h2 className="mt-4 text-3xl md:text-5xl font-black text-white">
            Tudo em <span className="grad-text">um único sistema</span>
          </h2>
          <p className="mt-4 text-white/60">
            Deslize entre as principais funcionalidades que transformam sua lanchonete num super app de delivery.
          </p>
        </div>

        <div className="relative">
          {/* Viewport */}
          <div className="overflow-hidden rounded-3xl" ref={emblaRef}>
            <div className="flex">
              {SLIDES.map((s, i) => (
                <div key={i} className="flex-[0_0_100%] min-w-0 px-1">
                  <div className="grid md:grid-cols-2 gap-6 md:gap-10 items-center rounded-3xl border border-orange/20 bg-gradient-to-br from-black via-black/90 to-orange/5 p-5 md:p-10 shadow-[0_0_60px_-10px_rgba(255,120,30,0.25)]">
                    <div className="relative aspect-[4/3] md:aspect-[5/4] rounded-2xl overflow-hidden border border-white/10">
                      <img
                        src={s.img}
                        alt={s.alt}
                        width={1280}
                        height={960}
                        loading="lazy"
                        draggable={false}
                        className="w-full h-full object-cover select-none"
                      />
                      <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-orange/10" />
                      <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-orange px-2.5 py-1 bg-black/70 backdrop-blur rounded-md border border-orange/40">
                        {s.icon} {s.tag}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-bold uppercase tracking-widest text-orange">{s.tag}</span>
                      <h3 className="mt-3 text-2xl md:text-4xl font-black text-white leading-tight">{s.title}</h3>
                      <p className="mt-4 text-white/70 text-base md:text-lg leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Arrows (desktop) */}
          <button
            onClick={scrollPrev}
            aria-label="Slide anterior"
            className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 w-12 h-12 items-center justify-center rounded-full bg-black/80 border border-orange/40 text-orange hover:bg-orange hover:text-black transition-all shadow-xl backdrop-blur"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={scrollNext}
            aria-label="Próximo slide"
            className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 w-12 h-12 items-center justify-center rounded-full bg-black/80 border border-orange/40 text-orange hover:bg-orange hover:text-black transition-all shadow-xl backdrop-blur"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>

        {/* Dots */}
        <div className="flex justify-center items-center gap-2 mt-6">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => scrollTo(i)}
              aria-label={`Ir para slide ${i + 1}`}
              className={`h-2 rounded-full transition-all ${i === selectedIndex ? 'w-8 bg-orange' : 'w-2 bg-white/25 hover:bg-white/50'}`}
            />
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-10">
          <a
            href="#contato"
            className="inline-flex items-center gap-2 px-7 py-4 rounded-full bg-orange text-black font-black text-base md:text-lg shadow-[0_0_40px_rgba(255,120,30,0.5)] hover:scale-105 transition-transform"
          >
            Quero esse sistema em minha lanchonete <ArrowRight className="w-5 h-5" />
          </a>
        </div>
      </div>
    </section>
  );
};

export default SuperAppCarousel;
