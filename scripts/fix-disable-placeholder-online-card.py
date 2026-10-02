from pathlib import Path
p=Path('src/components/kiosk/PaymentScreen.tsx')
s=p.read_text()
assert "const [card, setCard] = useState({ number: '', holder: '', expiry: '', cvv: '' });" in s
assert "storeSettings.payOnline && { key: 'online' as Method" in s
# Never collect raw PAN/CVV until a tokenized PCI-compliant gateway is implemented.
s=s.replace("  // Online card form (placeholder; integração futura)\n  const [card, setCard] = useState({ number: '', holder: '', expiry: '', cvv: '' });\n", "")
s=s.replace("    storeSettings.payOnline && { key: 'online' as Method, label: 'Cartão Online', desc: 'Pagar com cartão pelo celular', icon: <Globe className=\"w-6 h-6\" /> },", "    // Cartão online permanece oculto até existir checkout tokenizado pelo gateway.\n    // Não coletar PAN/CVV diretamente no VisionFood.\n    false && storeSettings.payOnline && { key: 'online' as Method, label: 'Cartão Online', desc: 'Indisponível até configurar gateway seguro', icon: <Globe className=\"w-6 h-6\" /> },")
start=s.index("  // === Online card form (preparado para gateway) ===")
end=s.index("  // === Pix", start)
s=s[:start]+"  // Cartão online não renderiza formulário local: dados sensíveis devem ser tokenizados pelo provedor de pagamento.\n\n"+s[end:]
assert 'card.cvv' not in s
assert 'Número do cartão' not in s
assert 'false && storeSettings.payOnline' in s
p.write_text(s)
print('online card placeholder disabled safely')
