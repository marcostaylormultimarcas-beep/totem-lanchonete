// Templates de cardápio para o Onboarding Rápido.
// Cada template injeta produtos genéricos para a loja recém-criada.

export type CardapioTemplateKey =
  | 'hamburgueria'
  | 'pizzaria'
  | 'distribuidora'
  | 'acaiteria';

export interface TemplateProduct {
  name: string;
  price: number;
  category: string;
  image: string;
  description: string;
}

export interface CardapioTemplate {
  key: CardapioTemplateKey;
  label: string;
  icon: string;
  categorias: { key: string; label: string; icon: string }[];
  produtos: TemplateProduct[];
}

export const CARDAPIO_TEMPLATES: CardapioTemplate[] = [
  {
    key: 'hamburgueria',
    label: 'Hamburgueria',
    icon: '🍔',
    categorias: [
      { key: 'hamburgueres', label: 'Hambúrgueres', icon: '🍔' },
      { key: 'acompanhamentos', label: 'Acompanhamentos', icon: '🍟' },
      { key: 'bebidas', label: 'Bebidas', icon: '🥤' },
    ],
    produtos: [
      { name: 'Classic Burger', price: 24.9, category: 'hamburgueres', image: '🍔', description: 'Blend 150g, queijo, alface e tomate.' },
      { name: 'Cheddar Bacon', price: 32.9, category: 'hamburgueres', image: '🥓', description: 'Blend 180g, cheddar cremoso e bacon.' },
      { name: 'Duplo Salada', price: 36.9, category: 'hamburgueres', image: '🍔', description: 'Dois blends, queijo, salada completa.' },
      { name: 'Batata Frita', price: 14.9, category: 'acompanhamentos', image: '🍟', description: 'Porção generosa, crocante.' },
      { name: 'Onion Rings', price: 16.9, category: 'acompanhamentos', image: '🧅', description: 'Anéis de cebola empanados.' },
      { name: 'Refrigerante Lata', price: 7.0, category: 'bebidas', image: '🥤', description: '350ml gelado.' },
    ],
  },
  {
    key: 'pizzaria',
    label: 'Pizzaria',
    icon: '🍕',
    categorias: [
      { key: 'pizzas', label: 'Pizzas', icon: '🍕' },
      { key: 'bebidas', label: 'Bebidas', icon: '🥤' },
    ],
    produtos: [
      { name: 'Pizza Mussarela', price: 45.0, category: 'pizzas', image: '🍕', description: 'Molho, mussarela e orégano.' },
      { name: 'Pizza Calabresa', price: 49.0, category: 'pizzas', image: '🍕', description: 'Calabresa fatiada e cebola.' },
      { name: 'Pizza Portuguesa', price: 52.0, category: 'pizzas', image: '🍕', description: 'Presunto, ovo, cebola e azeitona.' },
      { name: 'Pizza Quatro Queijos', price: 55.0, category: 'pizzas', image: '🧀', description: 'Mussarela, provolone, parmesão e gorgonzola.' },
      { name: 'Refrigerante 2L', price: 15.0, category: 'bebidas', image: '🥤', description: 'Refri gelado 2 litros.' },
      { name: 'Suco Natural', price: 9.0, category: 'bebidas', image: '🧃', description: 'Suco natural 500ml.' },
    ],
  },
  {
    key: 'distribuidora',
    label: 'Distribuidora de Bebidas',
    icon: '🍺',
    categorias: [
      { key: 'cervejas', label: 'Cervejas', icon: '🍺' },
      { key: 'destilados', label: 'Destilados', icon: '🥃' },
      { key: 'refrigerantes', label: 'Refrigerantes', icon: '🥤' },
    ],
    produtos: [
      { name: 'Cerveja Long Neck', price: 8.0, category: 'cervejas', image: '🍺', description: 'Long neck 355ml gelada.' },
      { name: 'Cerveja Lata 350ml', price: 5.5, category: 'cervejas', image: '🍻', description: 'Lata gelada 350ml.' },
      { name: 'Pack Cerveja 12un', price: 60.0, category: 'cervejas', image: '📦', description: 'Pack com 12 latas.' },
      { name: 'Whisky Nacional', price: 75.0, category: 'destilados', image: '🥃', description: 'Garrafa 1L.' },
      { name: 'Vodka', price: 45.0, category: 'destilados', image: '🍸', description: 'Garrafa 900ml.' },
      { name: 'Refrigerante 2L', price: 12.0, category: 'refrigerantes', image: '🥤', description: 'Garrafa 2L.' },
    ],
  },
  {
    key: 'acaiteria',
    label: 'Açaiteria',
    icon: '🍧',
    categorias: [
      { key: 'acai', label: 'Açaí', icon: '🍧' },
      { key: 'sorvetes', label: 'Sorvetes', icon: '🍦' },
      { key: 'bebidas', label: 'Bebidas', icon: '🥤' },
    ],
    produtos: [
      { name: 'Açaí 300ml', price: 14.9, category: 'acai', image: '🍧', description: 'Açaí cremoso 300ml com acompanhamentos.' },
      { name: 'Açaí 500ml', price: 19.9, category: 'acai', image: '🍨', description: 'Açaí 500ml com até 3 adicionais.' },
      { name: 'Açaí Família 1L', price: 34.9, category: 'acai', image: '🥣', description: 'Açaí 1L com adicionais variados.' },
      { name: 'Sorvete Casquinha', price: 6.0, category: 'sorvetes', image: '🍦', description: 'Casquinha simples.' },
      { name: 'Milk Shake', price: 16.0, category: 'sorvetes', image: '🥤', description: 'Milk shake 400ml.' },
      { name: 'Água Mineral', price: 4.0, category: 'bebidas', image: '💧', description: 'Garrafa 500ml.' },
    ],
  },
];

export const getTemplate = (key: CardapioTemplateKey) =>
  CARDAPIO_TEMPLATES.find((t) => t.key === key)!;
