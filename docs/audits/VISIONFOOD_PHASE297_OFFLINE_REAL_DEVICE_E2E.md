# VisionFood V2 — PHASE 297 — Offline real-device E2E + production activation gate

## Regra de evidência

HEAD inicial auditado: 943a9f54fc9eaf7051a7d99519a1f30e0e84c745.

Testes automatizados validam componentes, invariantes, restart e idempotência, mas NÃO substituem o E2E em hardware real.
Sem hardware real disponível, REAL DEVICE E2E deve permanecer BLOQUEADO.

Não usar DevTools Offline, mocks de RPC ou simulação de rede como prova comercial. A prova comercial exige totem provisionado, companion real, navegador real e interrupção real da conectividade.

## Harness

1. Host do totem:
   npm run phase297:preflight -- --origin=https://ORIGEM_DO_TOTEM

   Verifica device.json, fila persistente, IDs únicos, estados, ownership device_guest, cash/pending, ausência de material de autenticação nos payloads, permissões locais POSIX e companion em 127.0.0.1:43129.
   A credencial do companion nunca é impressa.

2. Navegador real:
   carregar tools/visionfood-offline-e2e/browser-preflight.js como DevTools Snippet e executar:
   await visionFoodPhase297Preflight({ expectOffline: false })
   e, depois do corte real:
   await visionFoodPhase297Preflight({ expectOffline: true })

   O snippet verifica Service Worker ativo/controlando a página, app shell derivado do vite-manifest, snapshots públicos, companion/enrollment/fila, ausência de tokens Supabase no navegador e alcançabilidade real da autoridade Supabase.

3. Companion smoke:
   inclui cenário de crash depois de commit autoritativo e antes do ACK local. O retry usa os mesmos local_order_id/client_request_id e exige ACK idempotente sem segunda ordem no simulador autoritativo.

## E2E real obrigatório

### Pré-condições online

- Totem físico provisionado usando o mesmo browser/profile da operação.
- Companion real em 127.0.0.1:43129 para a origem HTTPS exata.
- Enrollment ativo e da mesma organização da rota /cardapio/:slug.
- Abrir a rota online e aguardar warm-up público.
- Executar os dois preflights em modo online.
- Exigir PASSOU para SW ativo/controlando, app shell, organization/storefront/catalog/theme/payment/delivery snapshots, companion/enrollment/fila, zero auth de cliente persistido e Supabase alcançável.
- Qualquer falha bloqueia a etapa offline.

### Corte real

- Desconectar a conectividade do dispositivo; não usar somente emulação do navegador.
- Executar o browser preflight com expectOffline true.
- Exigir autoridade Supabase inalcançável e companion/cache/snapshots ainda válidos.

### Cold-start offline

- Fechar completamente o navegador.
- Reabrir com o mesmo profile, ainda sem internet.
- Abrir diretamente /cardapio/:slug.
- Confirmar visualmente cold-start pelo Service Worker.
- Reexecutar browser preflight offline.
- Navegar landing -> início/local -> menu -> produto -> carrinho -> checkout.
- Não usar QR de mesa, CEP remoto, cupom novo, Vision Prime, Pix/cartão ou qualquer bypass.
- Informar apenas identificação mínima e selecionar cash.

### Fila durável + restart

- Confirmar o checkout cash.
- Registrar local_order_id, client_request_id, state=pending_local e sequence.
- Fechar o navegador.
- Reiniciar o companion real pelo mecanismo de serviço do totem.
- Reabrir o navegador ainda offline.
- Reexecutar os preflights.
- O mesmo pedido deve permanecer; IDs não podem mudar; nenhuma duplicata pode aparecer.

### Retorno da internet + reconciliação

- Restaurar a conexão real.
- Não reenviar o pedido pelo navegador.
- O sync loop do companion deve usar o item persistido.
- Resultado permitido: synced com ACK autoritativo ou needs_attention quando termos autoritativos divergirem.
- needs_attention é fail-closed e não deve virar pedido silenciosamente.
- Para synced, registrar order_id, client_request_id, device_id, total e idempotent.

Validação administrativa autorizada:

~~~sql
select
  kiosk_device_id,
  client_request_id,
  count(*) as order_count,
  min(id) as order_id
from public.orders
where kiosk_device_id = '<DEVICE_ID>'::uuid
  and client_request_id = '<CLIENT_REQUEST_ID>'::uuid
group by kiosk_device_id, client_request_id;
~~~

Esperado: order_count = 1.

~~~sql
select state, order_id, attempt_count, conflict_reason
from private.kiosk_order_syncs
where device_id = '<DEVICE_ID>'::uuid
  and client_request_id = '<CLIENT_REQUEST_ID>'::uuid;
~~~

Esperado no sucesso: uma linha, state=synced e order_id igual ao pedido criado.

## Gate de migrations 290/292/293

O histórico remoto consultado nesta fase termina em:
20260919173654_visionfood_v2_pdv_order_lookup_literal_prefix_phase259

O branch possui 26 migrations posteriores ainda não registradas remotamente. As três offline são as últimas, mas existem 23 anteriores (260–287) antes delas.

Pendentes:
1. 20260919174710_visionfood_v2_pdv_cash_summary_refund_method_phase260.sql
2. 20260919180000_visionfood_v2_pdv_catalog_stock_availability_phase261.sql
3. 20260919182000_visionfood_v2_pdv_pix_intent_stock_guard_phase262.sql
4. 20260919183000_visionfood_v2_pdv_login_concurrency_phase263.sql
5. 20260919184200_visionfood_v2_pdv_refund_quantity_guard_phase264.sql
6. 20260919185000_visionfood_v2_pdv_close_integrity_phase265.sql
7. 20260919191659_visionfood_v2_pdv_pix_status_contract_phase267.sql
8. 20260919193000_visionfood_v2_pdv_movement_validation_phase268.sql
9. 20260919193100_visionfood_v2_pdv_sale_payment_guard_phase270.sql
10. 20260919203000_visionfood_v2_pdv_coupon_validation_contract_phase273.sql
11. 20260919215500_visionfood_v2_quote_checkout_delivery_rules_phase274.sql
12. 20260919222100_visionfood_v2_delivery_cep_uniqueness_phase275.sql
13. 20260919223000_visionfood_v2_checkout_coupon_expiry_alignment_phase276.sql
14. 20260919224000_visionfood_v2_vision_prime_public_config_contract_phase277.sql
15. 20260919231000_visionfood_v2_checkout_payment_effective_methods_phase278.sql
16. 20260919234500_visionfood_v2_checkout_removable_ingredients_alignment_phase280.sql
17. 20260919234600_visionfood_v2_public_delivery_areas_contract_phase281.sql
18. 20260919235500_visionfood_v2_public_loyalty_contract_phase282.sql
19. 20260920000500_visionfood_v2_public_order_tracking_contract_phase283.sql
20. 20260920001224_visionfood_v2_public_organization_slug_isolation_phase284.sql
21. 20260920005100_visionfood_v2_public_product_reviews_isolation_phase285.sql
22. 20260920010500_visionfood_v2_public_storefront_config_normalization_phase286.sql
23. 20260920011000_visionfood_v2_public_theme_normalization_phase287.sql
24. 20260920023000_visionfood_v2_shared_tables_offline_checkout_phase290.sql
25. 20260920124600_visionfood_v2_kiosk_device_companion_phase292.sql
26. 20260920133000_visionfood_v2_kiosk_authoritative_sync_phase293.sql

Regras do gate:
- PROIBIDO executar db push genérico para tentar ativar apenas 290/292/293.
- PROIBIDO marcar 260–287 como applied por migration repair sem provar que o schema remoto já contém exatamente essas alterações.
- Primeiro reconciliar o backlog e deixar histórico local/remoto contínuo.
- Depois, com autorização explícita, a ordem offline é 290 -> 292 -> 293.
- Antes da janela: reconsultar history, confirmar backup/PITR recuperável, validar base limpa/reproduzível, executar db push --dry-run e revisar a lista exata, confirmar nenhuma Edge Function necessária e usar apenas um dispositivo piloto inicialmente.
- Após ativação futura: validar tabelas/ACLs/funções/índices, enrollment piloto, heartbeat e executar todo o E2E real.

## Recovery

Preferir correção forward. Não apagar automaticamente estruturas que podem conter pedidos.
Se 290 aplicar e 292/293 falharem, bloquear device-owned e corrigir forward.
Se 292 aplicar e 293 falhar, não enrolar dispositivos comerciais; manter/revogar inativos até reparo.
Se 293 aplicar mas o E2E falhar, desativar piloto/companion, preservar fila e registros de sync e bloquear novos checkouts offline.
Restaurar backup como rollback duro somente quando for comprovado que não há writes comerciais posteriores ao ponto de restauração.

## Critério de saída da PHASE 297

HARNESS/RUNBOOK pode ser concluído com testes automatizados verdes.
REAL DEVICE OFFLINE E2E permanece BLOQUEADO sem hardware real.
REMOTE AUTHORITATIVE RECONCILIATION permanece BLOQUEADO enquanto 290/292/293 não estiverem ativas.
PRODUCTION ACTIVATION GATE permanece BLOQUEADO enquanto as 23 migrations anteriores não forem reconciliadas.
FULL OFFLINE COMMERCIAL MODE permanece NÃO PRONTO até prova E2E real completa.
