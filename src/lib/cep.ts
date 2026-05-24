// Utilitários CEP — integra ViaCEP (endereço) + Nominatim/OSM (geocodificação gratuita).
// Não requer API key.

export interface ViaCepResult {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}

export interface GeoCoords {
  lat: number;
  lng: number;
}

export const normalizeCep = (input: string): string =>
  (input || '').replace(/\D/g, '').slice(0, 8);

export const maskCep = (input: string): string => {
  const n = normalizeCep(input);
  if (n.length <= 5) return n;
  return n.slice(0, 5) + '-' + n.slice(5);
};

export async function fetchViaCep(cep: string): Promise<ViaCepResult | null> {
  const n = normalizeCep(cep);
  if (n.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${n}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.erro) return null;
    return {
      cep: n,
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      uf: data.uf || '',
    };
  } catch (e) {
    console.warn('[CEP] erro ViaCEP:', e);
    return null;
  }
}

// Geocodifica um endereço usando Nominatim (OpenStreetMap). Sem chave, mas é rate-limited (1 req/s).
export async function geocodeAddress(query: string): Promise<GeoCoords | null> {
  if (!query.trim()) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (e) {
    console.warn('[CEP] erro geocode:', e);
    return null;
  }
}

export async function geocodeCep(cep: string): Promise<{ address: ViaCepResult; coords: GeoCoords | null } | null> {
  const address = await fetchViaCep(cep);
  if (!address) return null;
  const q = [address.logradouro, address.bairro, address.cidade, address.uf, 'Brasil']
    .filter(Boolean).join(', ');
  const coords = await geocodeAddress(q || `${address.cep}, Brasil`);
  return { address, coords };
}

export function haversineKm(a: GeoCoords, b: GeoCoords): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
