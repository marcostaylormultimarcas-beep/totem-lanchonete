from pathlib import Path

p = Path('src/pages/Admin.tsx')
s = p.read_text(encoding='utf-8')

s = s.replace("import { useState, useEffect } from 'react';", "import { lazy, Suspense, useState, useEffect } from 'react';")

imports = [
"CrmPanel","ClientesLeadsPanel","OrdersPanel","DashboardPanel","MasterPanel","SuperAdminPanel","PlansMatrixPanel","OrgSwitcher","ChangePasswordCard","CouponsPanel","LoyaltyPanel","StorageUsageCard","MasterRecoveryPinCard","MercadoPagoCard","FiscalExportCard","EntregadoresPanel","BairrosPanel","LogisticaPanel","VisionPrimePanel","CoMarketingPanel","CoMarketingGlobalMap","OperacaoPanel","AssistenteVisionPanel","PersonalizacaoVisualPanel","ImpressaoTermicaPanel","FinanceiroPanel","EstoqueInteligentePanel","EstoquePreditivPanel","RoteirizacaoIAPanel","OneSignalPanel","AreaAtendimentoPanel","DeliveryPanel","AssinaturaPanel","MasterBillingPanel","MultiLojasPanel","SenhasPanel","OperadoresPdvPanel"
]

for name in imports:
    line = f"import {name} from '@/components/admin/{name}';\n"
    if line not in s:
        raise SystemExit(f'missing expected import: {name}')
    s = s.replace(line, '')

anchor = "import InstallAppButton from '@/components/pwa/InstallAppButton';\n"
if anchor not in s:
    raise SystemExit('missing InstallAppButton anchor')

lazy_lines = "\n// Heavy admin modules are loaded only when the Admin route needs them.\n" + "\n".join(
    f"const {name} = lazy(() => import('@/components/admin/{name}'));" for name in imports
) + "\n"
s = s.replace(anchor, anchor + lazy_lines)

# One Suspense boundary keeps existing tab rendering logic intact while moving
# panel modules out of the initial Admin chunk.
marker = "  return (\n    <div className=\"admin-shell min-h-screen pb-8 text-zinc-100\">"
replacement = "  return (\n    <Suspense fallback={<div className=\"min-h-screen flex items-center justify-center\"><Loader2 className=\"w-8 h-8 animate-spin text-primary\" /></div>}>\n    <div className=\"admin-shell min-h-screen pb-8 text-zinc-100\">"
if marker not in s:
    raise SystemExit('missing Admin return marker')
s = s.replace(marker, replacement, 1)

end = "    </div>\n  );\n};\n\nexport default AdminPage;"
end_replacement = "    </div>\n    </Suspense>\n  );\n};\n\nexport default AdminPage;"
if end not in s:
    raise SystemExit('missing Admin closing marker')
s = s.replace(end, end_replacement, 1)

p.write_text(s, encoding='utf-8')
print(f'lazy-loaded {len(imports)} admin panels')
