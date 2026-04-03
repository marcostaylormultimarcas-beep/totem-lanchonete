

## Plano: Landing Page do Totem ("Toque para Iniciar")

### O que será feito

Adicionar um novo step `'landing'` antes do `'start'` no fluxo do Index. Essa tela será uma landing page fullscreen com:

- **Fundo**: Imagem de alta qualidade (hambúrguer/lanchonete) com overlay escuro gradiente
- **Centro**: Texto "TOQUE PARA INICIAR SEU PEDIDO" com animação pulsante (`pulse-glow` já existente no CSS)
- **Logo/nome** da loja no topo
- **Clique em qualquer lugar** da tela avança para o step `'start'` (tela atual com banners/categorias)

### Arquivos modificados

1. **`src/components/kiosk/LandingScreen.tsx`** (novo)
   - Componente fullscreen com `onClick` no container inteiro
   - Imagem de fundo via CSS `background-image` com overlay gradiente escuro
   - Botão central com classe `pulse-glow` + `animate-pulse`
   - Nome da loja no topo (lido de `getSettings()`)
   - Responsivo: texto maior em telas de totem/desktop

2. **`src/pages/Index.tsx`**
   - Adicionar `'landing'` ao type `Step`, definir como estado inicial
   - Renderizar `LandingScreen` quando `step === 'landing'`
   - Ao clicar, avançar para `'start'`
   - `resetOrder` volta para `'landing'`

### Detalhes técnicos

- Usará imagem de placeholder (Unsplash URL de hambúrguer) que pode ser trocada no Admin futuramente
- Reutiliza a animação `pulse-glow` já definida em `src/index.css`
- Nenhuma mudança no banco de dados necessária

