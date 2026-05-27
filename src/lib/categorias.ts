// Categorias de nicho usadas pelo Clube de Vantagens.
// A proteção de nicho bloqueia parceiros da mesma categoria da loja de origem do cliente.
export const CATEGORIAS_LOJA = [
  { key: 'lanchonete', label: 'Lanchonete' },
  { key: 'hamburgueria', label: 'Hamburgueria' },
  { key: 'pizzaria', label: 'Pizzaria' },
  { key: 'sorveteria', label: 'Sorveteria' },
  { key: 'acaiteria', label: 'Açaiteria' },
  { key: 'distribuidora', label: 'Distribuidora' },
  { key: 'restaurante', label: 'Restaurante' },
  { key: 'padaria', label: 'Padaria' },
  { key: 'doceria', label: 'Doceria' },
  { key: 'japonesa', label: 'Japonesa' },
  { key: 'mexicana', label: 'Mexicana' },
  { key: 'cafeteria', label: 'Cafeteria' },
  { key: 'outro', label: 'Outro' },
] as const;

export type CategoriaLojaKey = typeof CATEGORIAS_LOJA[number]['key'];

export const labelCategoria = (key?: string | null) =>
  CATEGORIAS_LOJA.find(c => c.key === key)?.label || 'Outro';
