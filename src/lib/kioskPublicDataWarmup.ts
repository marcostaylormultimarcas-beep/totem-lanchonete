import { fetchPublicCatalog } from '@/lib/publicCatalog';
import { fetchPublicCheckoutPaymentConfig } from '@/lib/publicCheckoutPaymentConfig';
import { fetchPublicDeliveryAreas } from '@/lib/publicDeliveryAreas';
import { fetchPublicOrganization } from '@/lib/publicOrganization';
import { fetchPublicStorefrontConfig } from '@/lib/publicStorefrontConfig';
import { fetchPublicTheme } from '@/lib/publicTheme';

const MAX_MEDIA_URLS = 200;
const SENSITIVE_QUERY_KEYS = ['token', 'access_token', 'signature', 'sig', 'expires', 'apikey', 'api_key'];

function safePublicMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    const lowered = Array.from(url.searchParams.keys()).map((key) => key.toLowerCase());
    if (lowered.some((key) => SENSITIVE_QUERY_KEYS.includes(key))) return null;
    return url.href;
  } catch {
    return null;
  }
}

function collectMediaUrls(
  organization: Awaited<ReturnType<typeof fetchPublicOrganization>>,
  storefront: Awaited<ReturnType<typeof fetchPublicStorefrontConfig>>,
  catalog: Awaited<ReturnType<typeof fetchPublicCatalog>>,
) {
  const candidates: unknown[] = [
    organization?.logo_url,
    storefront.share_image,
    ...catalog.map((item) => item.image),
  ];

  const banners = Array.isArray(storefront.banners) ? storefront.banners : [];
  for (const banner of banners) {
    if (banner && typeof banner === 'object') {
      const row = banner as Record<string, unknown>;
      candidates.push(row.image, row.image_url);
    }
  }

  if (storefront.category_icons && typeof storefront.category_icons === 'object') {
    candidates.push(...Object.values(storefront.category_icons as Record<string, unknown>));
  }

  if (storefront.combo && typeof storefront.combo === 'object') {
    const combo = storefront.combo as Record<string, unknown>;
    candidates.push(combo.image, combo.image_url);
  }

  return Array.from(new Set(
    candidates.map(safePublicMediaUrl).filter((url): url is string => Boolean(url)),
  )).slice(0, MAX_MEDIA_URLS);
}

function requestMediaPrecache(urls: string[]) {
  if (!urls.length || !('serviceWorker' in navigator)) return;
  const send = (worker: ServiceWorker | null) => {
    worker?.postMessage({ type: 'VISIONFOOD_PRECACHE_PUBLIC_URLS', urls });
  };

  if (navigator.serviceWorker.controller) {
    send(navigator.serviceWorker.controller);
    return;
  }

  void navigator.serviceWorker.ready.then((registration) => {
    send(registration.active);
  }).catch(() => undefined);
}

export async function warmKioskPublicData(organizationId: string) {
  const [organization, storefront, catalog] = await Promise.all([
    fetchPublicOrganization({ id: organizationId }),
    fetchPublicStorefrontConfig(organizationId),
    fetchPublicCatalog(organizationId),
  ]);

  await Promise.allSettled([
    fetchPublicTheme(organizationId),
    fetchPublicCheckoutPaymentConfig(organizationId),
    fetchPublicDeliveryAreas(organizationId),
  ]);

  requestMediaPrecache(collectMediaUrls(organization, storefront, catalog));

  return {
    organization: Boolean(organization?.id),
    storefront: Boolean(storefront),
    catalogCount: catalog.length,
  };
}
