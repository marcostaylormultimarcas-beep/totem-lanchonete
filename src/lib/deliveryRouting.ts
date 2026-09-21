export const MAX_EXACT_DESTINATION_ACCURACY_M = 100;
export const MAX_DRIVER_CONFIRM_ACCURACY_M = 100;

export interface RoutePoint {
  lat: number;
  lng: number;
}

const validPoint = (point: RoutePoint) =>
  Number.isFinite(point.lat)
  && Number.isFinite(point.lng)
  && point.lat >= -90
  && point.lat <= 90
  && point.lng >= -180
  && point.lng <= 180;

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
