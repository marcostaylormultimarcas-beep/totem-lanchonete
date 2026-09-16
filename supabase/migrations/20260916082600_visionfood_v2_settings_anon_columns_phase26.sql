REVOKE SELECT ON TABLE public.settings FROM anon;
GRANT SELECT (
  id, organization_id, store_name, whatsapp_number, cover_image, combo, banners,
  category_icons, categories, instagram_url, imagem_capa, logo_url,
  delivery_enabled, nome_loja, telefone, endereco, pix_chave, taxa_delivery,
  cep_lat, cep_lng, cep_lon, cep_loja, delivery_mode, delivery_raio_km,
  delivery_taxa_base, delivery_taxa_por_km, delivery_tempo_base_min,
  delivery_tempo_por_km_min, delivery_horario_inicio, delivery_horario_fim,
  delivery_pedido_minimo, delivery_tempo_estimado, business_hours,
  allow_scheduling, closed_message, opening_hours, emergency_closed,
  scheduling_enabled, is_open, phone, address, created_at, updated_at
) ON public.settings TO anon;
