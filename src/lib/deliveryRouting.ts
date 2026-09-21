export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RoadRoute {
  points: RoutePoint[];
  distanceM: number;
  durationSec: number;
}

const validPoint = (point: RoutePoint) =>
  Number.isFinite(point.lat)
  && Number.isFinite(point.lng)
  && point.lat >= -90
  && point.lat <= 90
  && point.lng >= -180
  && point.lng <= 180;

export async function fetchRoadRoute(origin: RoutePoint, destination: RoutePoint): Promise<RoadRoute | null> {
  if (!validPoint(origin) || !validPoint(destination)) return null;

  try {
    const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=simplified&geometries=geojson&steps=false&alternatives=false`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;

    const payload = await response.json();
    const route = Array.isArray(payload?.routes) ? payload.routes[0] : null;
    const rawCoordinates = route?.geometry?.coordinates;
    if (!route || !Array.isArray(rawCoordinates) || rawCoordinates.length < 2) return null;

    const points = rawCoordinates
      .map((entry: unknown) => {
        if (!Array.isArray(entry) || entry.length < 2) return null;
        const lng = Number(entry[0]);
        const lat = Number(entry[1]);
        const point = { lat, lng };
        return validPoint(point) ? point : null;
      })
      .filter(Boolean) as RoutePoint[];

    if (points.length < 2) return null;

    const distanceM = Number(route.distance);
    const durationSec = Number(route.duration);
    if (!Number.isFinite(distanceM) || !Number.isFinite(durationSec)) return null;

    return {
      points,
      distanceM: Math.max(0, distanceM),
      durationSec: Math.max(0, durationSec),
    };
  } catch (error) {
    console.warn('[Routing] route provider unavailable:', error);
    return null;
  }
}

export function formatRouteDistance(distanceM: number) {
  if (!Number.isFinite(distanceM)) return '';
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

export function formatRouteDuration(durationSec: number) {
  if (!Number.isFinite(durationSec)) return '';
  const minutes = Math.max(1, Math.round(durationSec / 60));
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `~${hours}h ${rest}min` : `~${hours}h`;
}

export function googleMapsDirectionsUrl(destination: RoutePoint, origin?: RoutePoint | null) {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lng}`,
    travelmode: 'driving',
  });
  if (origin && validPoint(origin)) {
    params.set('origin', `${origin.lat},${origin.lng}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
