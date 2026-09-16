from pathlib import Path

# Historical guarded migration retained for auditability.
# The migration has already been applied to src/pages/Admin.tsx.
p = Path('src/pages/Admin.tsx')
s = p.read_text(encoding='utf-8')

required = [
    "import { lazy, Suspense, useState, useEffect } from 'react';",
    "const CrmPanel = lazy(() => import('@/components/admin/CrmPanel'));",
    "const OperadoresPdvPanel = lazy(() => import('@/components/admin/OperadoresPdvPanel'));",
    "<Suspense fallback=",
    "</Suspense>",
]
missing = [marker for marker in required if marker not in s]
if missing:
    raise SystemExit(f'admin lazy migration is not fully applied; missing: {missing}')

print('admin lazy migration already applied and verified')
