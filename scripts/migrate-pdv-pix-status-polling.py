from pathlib import Path

p = Path('src/pages/PDV.tsx')
s = p.read_text(encoding='utf-8')

anchor = '''  useEffect(() => {\n    const payload = {\n'''
if anchor not in s:
    raise SystemExit('guard failed: mirror effect anchor not found')
if 'const [pixConfirmed, setPixConfirmed]' in s:
    raise SystemExit('guard failed: PIX polling already present')

polling = '''  const [pixConfirmed, setPixConfirmed] = useState(false);\n  useEffect(() => {\n    setPixConfirmed(false);\n    if (forma !== "pix" || !pixData?.intentId || !sessionToken) return;\n    let active = true;\n    let timer: ReturnType<typeof setTimeout> | null = null;\n    const check = async () => {\n      const { data, error } = await pdvRpc.pixStatus(sessionToken, pixData.intentId);\n      if (!active) return;\n      const status = data as any;\n      const paid = !error && status?.ok && (status?.paid === true || ["paid", "approved"].includes(String(status?.status || "").toLowerCase()) || String(status?.payment_status || "").toLowerCase() === "approved");\n      if (paid) {\n        setPixConfirmed(true);\n        toast.success("PIX confirmado");\n        return;\n      }\n      timer = setTimeout(check, 2500);\n    };\n    timer = setTimeout(check, 1200);\n    return () => {\n      active = false;\n      if (timer) clearTimeout(timer);\n    };\n  }, [forma, pixData?.intentId, sessionToken]);\n\n'''
s = s.replace(anchor, polling + anchor, 1)

old = '''    if (forma === "pix") {\n      if (!pixData?.intentId) return toast.error("Gere o PIX antes de finalizar");\n      const { data: pixStatusData, error: pixStatusError } = await pdvRpc.pixStatus(sessionToken, pixData.intentId);\n      const pixStatus = pixStatusData as any;\n      if (pixStatusError || !pixStatus?.ok || !["paid", "approved"].includes(String(pixStatus.status || "").toLowerCase())) {\n        return toast.error("Pagamento PIX ainda não confirmado");\n      }\n    }\n'''
new = '''    if (forma === "pix") {\n      if (!pixData?.intentId) return toast.error("Gere o PIX antes de finalizar");\n      if (!pixConfirmed) {\n        const { data: pixStatusData, error: pixStatusError } = await pdvRpc.pixStatus(sessionToken, pixData.intentId);\n        const pixStatus = pixStatusData as any;\n        if (pixStatusError || !pixStatus?.ok || !(pixStatus?.paid === true || ["paid", "approved"].includes(String(pixStatus.status || "").toLowerCase()) || String(pixStatus.payment_status || "").toLowerCase() === "approved")) {\n          return toast.error("Pagamento PIX ainda não confirmado");\n        }\n        setPixConfirmed(true);\n      }\n    }\n'''
if old not in s:
    raise SystemExit('guard failed: finalize PIX status block not found')
s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('PIX polling migration applied')
