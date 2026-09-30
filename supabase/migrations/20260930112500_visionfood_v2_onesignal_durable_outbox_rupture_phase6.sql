-- OneSignal Durable Outbox V2 - phase 6.
--
-- Cut over the final legacy producer, stock rupture, to the durable outbox.
-- Predictive and delivery remain on their phase-4/phase-5 durable paths. The
-- ingredient trigger contract, organization scope, OneSignal payload and
-- idempotency semantics stay unchanged; retries reuse the frozen durable row.

create or replace function public.visionfood_push_rupture_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  rupture_idempotency_key uuid;
  rupture_outbox_id uuid;
begin
  if coalesce(old.estoque_atual,0)<=0
     or coalesce(new.estoque_atual,0)>0 then
    return new;
  end if;

  rupture_idempotency_key:=gen_random_uuid();

  begin
    rupture_outbox_id:=private.visionfood_onesignal_outbox_enqueue(
      new.organization_id,
      'stock_rupture',
      'ingredient_stock',
      new.id::text||':stock_rupture',
      jsonb_build_object(
        'filters',
        jsonb_build_array(
          jsonb_build_object(
            'field','tag','key','tipo','relation','=','value','admin'
          ),
          jsonb_build_object('operator','AND'),
          jsonb_build_object(
            'field','tag','key','organization_id','relation','=','value',new.organization_id::text
          )
        )
      ),
      jsonb_build_object(
        'headings',
        jsonb_build_object(
          'pt','🚨 Ruptura de Estoque'
        ),
        'contents',
        jsonb_build_object(
          'pt','O ingrediente "'||left(coalesce(new.nome,'Ingrediente'),120)||'" zerou. Verifique o estoque no painel.'
        ),
        'data',
        jsonb_build_object(
          'event','stock_rupture',
          'ingredient_id',new.id,
          'organization_id',new.organization_id
        )
      ),
      rupture_idempotency_key
    );
  exception
    when others then
      -- Preserve the legacy trigger contract: absent OneSignal configuration
      -- must never block the ingredient stock transition.
      if sqlstate='55000'
         and sqlerrm='onesignal_outbox_not_configured' then
        return new;
      end if;
      raise;
  end;

  -- Submit only this rupture row. pg_net is transport metadata; the durable
  -- outbox row is the source of truth for retries and semantic completion.
  perform private.visionfood_onesignal_outbox_dispatch_one(
    rupture_outbox_id,
    'rupture-trigger',
    30,
    15,
    8
  );

  return new;
end
$$;

revoke all on function public.visionfood_push_rupture_trigger()
  from public,anon,authenticated;
