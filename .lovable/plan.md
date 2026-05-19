Resumo das mudanças

### 1. Pedidos do Simulador NÃO devem ir para o painel

**Status atual:** Já existe `isDemoMode()` (lê `?modo=demo` da URL) e o `PaymentScreen` bloqueia a gravação no banco. Porém, ao navegar entre telas (Cardápio → Carrinho → Checkout → Pagamento) o query-string `?modo=demo` pode estar sendo perdido, fazendo o pedido cair no banco real.

**Fix:**

- Garantir persistência do modo demo em **sessionStorage** assim que `?modo=demo` for detectado na URL (em `src/lib/demoMode.ts`), para que `isDemoMode()` continue retornando `true` em qualquer rota subsequente da mesma aba.
- Adicionar verificação extra no `PaymentScreen` (já existe) e também silenciar o alerta sonoro / Realtime quando demo (não necessário, pois não grava).

### 2. Upload de Favicon / Imagem de compartilhamento (Open Graph) por loja

- Adicionar coluna `share_image` (text) na tabela `settings` via migration.
- Criar componente de upload no painel ADM (aba "Configurações da loja") usando `uploadProductImage` (já redimensiona para WebP 800px).
- No `Cardapio/:slug` (página pública da loja), injetar dinamicamente as meta tags `<meta property="og:image">`, `<meta name="twitter:image">` e `<link rel="icon">` com a URL salva em `settings.share_image` da loja carregada.

### 3. Botão "Abrir minha loja" no painel

- No painel de cada nível (ADM, Master, Super), adicionar um botão visível no topo (`<a target="_blank" href="/cardapio/{slug}">Abrir loja`) usando o `slug` da `organizations` vinculada ao usuário.
- Super/Master: aparece um botão por loja na listagem; ADM comum: um botão fixo no header do painel.

### 4. Chave da API do Mercado Pago (pagamento PIX)

> - **Observação:** Você escreveu "Mercado pago", mas a API que processa Pix/cartão é a do **Mercado Pago**. Crie um campo onde a os ADM podem colar a chave app e dps de colado funcione as formas de pagamento do mercado livre.

- Adicionar colunas em `settings`: `mp_access_token` (text, criptografado em uso) e `mp_public_key` (text).
- Campo na aba "Pagamentos" do painel ADM para colar as chaves.
- Criar **edge function** `mercadopago-create-pix` que recebe `{organization_id, amount, description}` e usa o `access_token` da loja para gerar uma cobrança Pix real (QR Code + copia-e-cola) via `https://api.mercadopago.com/v1/payments`.
- `PaymentScreen` chama essa função se a loja tiver token configurado e exibe o QR retornado; caso contrário cai no QR fake atual.

### 5. Chave Pix manual (texto sob o QR Code)

- Adicionar coluna `pix_key_manual` (text) em `settings`.
- Campo no painel ADM "Chave Pix (exibida no totem)".
- No `PaymentScreen`, exibir `settings.pix_key_manual` abaixo do QR code com botão "Copiar" (substituindo o `PIX_KEY` hard-coded).

### 6. Conversor de imagem (verificação)

- Já está **ativo e funcional** em `src/lib/imageUpload.ts`: redimensiona para máx. 800×800 e converte para **WebP com qualidade 0.8** antes do upload. Não requer alteração.

---

## Detalhamento técnico

**Migration única:**

```sql
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS share_image text DEFAULT '',
  ADD COLUMN IF NOT EXISTS pix_key_manual text DEFAULT '',
  ADD COLUMN IF NOT EXISTS mp_access_token text DEFAULT '',
  ADD COLUMN IF NOT EXISTS mp_public_key text DEFAULT '';
```

**Arquivos novos/alterados:**

- `src/lib/demoMode.ts` — persistir flag em sessionStorage
- `src/components/admin/StoreSettingsPanel.tsx` (ou similar existente) — campos: share image upload, pix manual, MP tokens, botão "abrir loja"
- `src/components/admin/AdminsPanel.tsx` / `MasterPanel.tsx` / `SuperAdminPanel.tsx` — botões "abrir loja" por linha
- `src/pages/Index.tsx` (rota `/cardapio/:slug`) — injetar meta OG/favicon via `document.head` no `useEffect`
- `src/components/kiosk/PaymentScreen.tsx` — usar `pix_key_manual` e MP real quando configurado
- `supabase/functions/mercadopago-create-pix/index.ts` — nova edge function

**Confirmação necessária antes de implementar:**

1. Confirma que é **Mercado Pago** (e não Mercado Livre / outro)?
2. Os tokens MP devem ficar visíveis (mascarados) no painel após salvos ou só "•••• alterar"?