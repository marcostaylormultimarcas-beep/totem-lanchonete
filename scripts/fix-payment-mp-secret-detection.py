from pathlib import Path
p=Path('src/components/kiosk/PaymentScreen.tsx')
s=p.read_text()
old="""const { data } = await supabase.from('settings').select('store_name, whatsapp_number, pix_key_manual, mp_access_token, pay_cash_enabled, pay_pix_enabled, pay_card_terminal_enabled, pay_card_online_enabled, mp_terminal_id').eq('organization_id', orgId).maybeSingle();"""
new="""const { data, error } = await supabase.from('settings').select('store_name, whatsapp_number, pix_key_manual, mp_access_token_secret_id, pay_cash_enabled, pay_pix_enabled, pay_card_terminal_enabled, pay_card_online_enabled, mp_terminal_id').eq('organization_id', orgId).maybeSingle();
      if (error) {
        console.warn('Não foi possível carregar as configurações de pagamento:', error);
        return;
      }"""
if s.count(old)!=1: raise SystemExit(f'settings select guard failed: {s.count(old)}')
s=s.replace(old,new,1)
old="""mpEnabled: Boolean((data as any).mp_access_token),"""
new="""mpEnabled: Boolean((data as any).mp_access_token_secret_id),"""
if s.count(old)!=1: raise SystemExit(f'mpEnabled guard failed: {s.count(old)}')
s=s.replace(old,new,1)
p.write_text(s)
print('secure payment configuration detection patch applied')
