from pathlib import Path

path = Path('src/components/kiosk/StartScreen.tsx')
text = path.read_text(encoding='utf-8')
old = "supabase.from('settings').select('*').eq('organization_id', orgId).maybeSingle()"
new = "supabase.from('settings').select('store_name,banners,instagram_url,whatsapp_number,categories,category_icons').eq('organization_id', orgId).maybeSingle()"
count = text.count(old)
if count != 1:
    raise SystemExit(f'Guard failed: expected exactly 1 broad settings select, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Hardened StartScreen public settings query.')
