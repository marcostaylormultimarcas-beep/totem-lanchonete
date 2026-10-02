export function sanitizeAuthReturnTo(
  value: string | null | undefined,
  fallback: string,
  origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
): string {
  const candidate = value?.trim();
  if (!candidate) return fallback;

  try {
    const base = new URL('/', origin);
    const target = new URL(candidate, base);
    if (target.origin !== base.origin) return fallback;

    const internalPath = `${target.pathname}${target.search}${target.hash}`;
    return internalPath.startsWith('/') ? internalPath : fallback;
  } catch {
    return fallback;
  }
}
