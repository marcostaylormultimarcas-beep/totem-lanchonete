from pathlib import Path

login = Path('src/pages/EntregadorLogin.tsx')
dash = Path('src/pages/EntregadorDashboard.tsx')

l = login.read_text()
d = dash.read_text()

assert 'password: string;' in l
assert "supabase.rpc('entregador_login' as any" in l
assert 'const session: EntregadorSession = { ...res.entregador, password };' in l

l = l.replace('  password: string;\n', '  session_token: string;\n')
l = l.replace("supabase.rpc('entregador_login' as any", "supabase.rpc('entregador_login_session' as any")
l = l.replace('const session: EntregadorSession = { ...res.entregador, password };', "const session: EntregadorSession = { ...res.entregador, session_token: res.session_token };")

repls = {
"supabase.rpc('entregador_update_location' as any, {\n        _entregador_id: session.id,\n        _password: session.password,": "supabase.rpc('entregador_update_location_session' as any, {\n        _session_token: session.session_token,",
"supabase.rpc('entregador_orders' as any, {\n      _entregador_id: session.id,\n      _password: session.password,\n    })": "supabase.rpc('entregador_orders_session' as any, {\n      _session_token: session.session_token,\n    })",
"supabase.rpc('entregador_available_orders' as any, {\n      _entregador_id: session.id,\n      _password: session.password,\n    })": "supabase.rpc('entregador_available_orders_session' as any, {\n      _session_token: session.session_token,\n    })",
"supabase.rpc('entregador_claim_order' as any, {\n      _entregador_id: session.id,\n      _password: session.password,": "supabase.rpc('entregador_claim_order_session' as any, {\n      _session_token: session.session_token,",
"supabase.rpc('confirm_delivery_with_code' as any, {\n      _entregador_id: session.id,\n      _password: session.password,": "supabase.rpc('confirm_delivery_with_code_session' as any, {\n      _session_token: session.session_token,",
}
for old, new in repls.items():
    assert old in d, old
    d = d.replace(old, new)

# Logout revokes server-side token best-effort, then always clears local state.
old_logout = "  const handleLogout = () => {\n    clearEntregadorSession();\n    navigate('/entregador/login');\n  };"
new_logout = "  const handleLogout = async () => {\n    try {\n      await supabase.rpc('entregador_logout_session' as any, { _session_token: session?.session_token });\n    } finally {\n      clearEntregadorSession();\n      navigate('/entregador/login');\n    }\n  };"
assert old_logout in d
d = d.replace(old_logout, new_logout)

# Token failures should invalidate the local session like legacy invalid credentials.
d = d.replace("res?.reason === 'invalid_credentials'", "['invalid_credentials', 'invalid_session'].includes(res?.reason)")
d = d.replace("invalid_credentials: 'Sessão inválida. Faça login novamente.',", "invalid_credentials: 'Sessão inválida. Faça login novamente.',\n        invalid_session: 'Sessão expirada. Faça login novamente.',")

assert 'session.password' not in d
assert 'password: string;' not in l
assert 'session_token' in l and 'session_token' in d

login.write_text(l)
dash.write_text(d)
print('driver token frontend cutover applied')
