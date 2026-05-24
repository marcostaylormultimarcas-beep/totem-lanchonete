## Módulo "Entrega por CEP" — Plano de implementação

Vou adicionar geolocalização via ViaCEP + cálculo de distância (Haversine) integrado ao fluxo de delivery atual.

### 1. Banco de dados (migration)

**`settings`** — novas colunas para a loja:
- `cep_loja` (text) — CEP central da loja
- `cep_lat` / `cep_lng` (numeric) — coordenadas resolvidas
- `delivery_mode` (text: `'lista_ceps'` | `'raio_km'` | `'bairros'`) — padrão `'bairros'` (mantém o atual)
- `delivery_raio_km` (numeric) — raio máximo de atendimento
- `delivery_taxa_base` (numeric) e `delivery_taxa_por_km` (numeric) — frete dinâmico
- `delivery_tempo_base_min` (int) e `delivery_tempo_por_km_min` (numeric) — tempo estimado

**Nova tabela `cep_atendidos`** (modo lista de CEPs):
- `organization_id`, `cep` (8 dígitos), `taxa` (numeric, opcional override), `tempo_min` (int, opcional)
- RLS: leitura pública (totem precisa), escrita só pelo dono da loja

**Função `public.validar_cep_entrega(_org uuid, _cep text, _lat numeric, _lng numeric)`** — `SECURITY DEFINER`, retorna `jsonb { ok, motivo, distancia_km, taxa, tempo_min }`. Consolida as 3 regras (lista / raio / bairros) num único ponto.

### 2. Lib utilitária `src/lib/cep.ts`

- `normalizeCep(input)` — só dígitos, 8 chars
- `fetchViaCep(cep)` — chama `https://viacep.com.br/ws/{cep}/json/`, retorna `{ cep, logradouro, bairro, cidade, uf }`
- `geocodeCep(cep)` — usa endpoint público `nominatim.openstreetmap.org` (sem chave) para resolver lat/lng a partir do endereço retornado pelo ViaCEP
- `haversineKm(a, b)` — distância em km entre dois pontos

### 3. Admin — painel "Área de Atendimento"

Novo componente `AreaAtendimentoPanel.tsx` (aba no Admin atual, próximo a Bairros):
- Campo CEP da loja com botão "Buscar" → preenche endereço + geocodifica
- Toggle de modo: **Por raio (km)** | **Por lista de CEPs** | **Por bairros** (existente)
- Modo raio: input numérico `raio_km`, taxa base, taxa por km, tempo base, tempo por km — preview "Atendemos até X km"
- Modo lista: CRUD simples de `cep_atendidos` (cep, taxa, tempo)
- Mantém compatibilidade com `taxas_entrega` (bairros) — só desliga quando `delivery_mode` é outro

### 4. Cliente — bloqueio por CEP no checkout

Adaptar `CheckoutScreen` (ou criar `CepGate` reutilizável):
- Quando o cliente escolhe **Delivery**, o primeiro campo é **CEP** com botão "Validar"
- Chama `fetchViaCep` → preenche endereço → chama RPC `validar_cep_entrega`
- Se `ok=false`: mostra card vermelho "Não entregamos nesta região 😔" e bloqueia continuar (botão Avançar desabilitado)
- Se `ok=true`: mostra "✓ Entregamos no seu endereço — taxa R$ X · ~Y min" e habilita o checkout
- Salva `delivery_cep`, `delivery_distance_km` no pedido (adicionar colunas em `orders`)

Modos `local` e `viagem` continuam sem CEP (não é entrega).

### 5. Integração com pedido

- `orders` ganha `delivery_cep` (text) e `delivery_distance_km` (numeric, nullable)
- Taxa de entrega calculada via RPC vai para `delivery_fee` (já existe)
- `bairro_nome` continua sendo preenchido (vem do ViaCEP) para compatibilidade

### 6. Logs e UX

- `console.log('[CEP]', ...)` nas etapas de validação para diagnóstico
- Mensagens claras em PT-BR ("CEP inválido", "Fora da área", "Sem conexão com ViaCEP")
- Loading states e erros com `toast.error`

### Arquivos previstos
- `supabase/migrations/<timestamp>_cep_delivery.sql`
- `src/lib/cep.ts` (nova)
- `src/components/admin/AreaAtendimentoPanel.tsx` (nova)
- `src/components/kiosk/CepGate.tsx` (nova, reutilizável)
- Edits: `src/pages/Admin.tsx`, `src/components/kiosk/CheckoutScreen.tsx`, `src/integrations/supabase/types.ts` (auto)

### Pontos a confirmar antes de implementar
1. Manter o modo "Bairros" atual como opção (sim, recomendo) ou substituir totalmente por CEP?
2. Geocodificação: usar Nominatim (OSM, gratuito, sem chave, com rate-limit) ou prefere já configurar Google Maps API? Vou seguir com Nominatim por ser zero-config — pode trocar depois.
3. O bloqueio por CEP é só para `order_type = 'delivery'` (correto). Pedidos local/viagem seguem sem CEP.
