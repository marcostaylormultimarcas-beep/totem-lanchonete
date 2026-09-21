import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default icon paths for Vite bundling
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

(L.Icon.Default.prototype as any)._getIconUrl = undefined;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const bikeIcon = L.divIcon({
  className: '',
  html: `<div style="background:#f59e0b;border:3px solid #18181b;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 0 18px rgba(245,158,11,0.9);">🛵</div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});

const destIcon = L.divIcon({
  className: '',
  html: `<div style="background:#dc2626;border:3px solid #18181b;border-radius:50% 50% 50% 0;transform:rotate(-45deg);width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 0 14px rgba(220,38,38,0.8);"><span style="transform:rotate(45deg)">📍</span></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

const FitBounds = ({ points }: { points: [number, number][] }) => {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 16);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    }
  }, [JSON.stringify(points), map]);
  return null;
};

interface Props {
  rider?: { lat: number; lng: number; updatedAt?: string } | null;
  destination?: { lat: number; lng: number; label?: string } | null;
  height?: string | number;
}

const LiveDeliveryMap = ({ rider, destination, height = 360 }: Props) => {
  const points = useMemo(() => {
    const p: [number, number][] = [];
    if (rider) p.push([rider.lat, rider.lng]);
    if (destination) p.push([destination.lat, destination.lng]);
    return p;
  }, [rider, destination]);

  const center: [number, number] = points[0] || [-14.235, -51.9253];

  return (
    <div
      className="rounded-xl overflow-hidden border border-amber-500/30"
      style={{ height, colorScheme: 'light', filter: 'none', mixBlendMode: 'normal' }}
    >
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom
        style={{ height: '100%', width: '100%', background: '#1a1a1a' }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap, &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        {rider && (
          <Marker position={[rider.lat, rider.lng]} icon={bikeIcon}>
            <Popup>
              🛵 Entregador
              {rider.updatedAt && (
                <><br /><span style={{ fontSize: 11 }}>Atualizado: {new Date(rider.updatedAt).toLocaleTimeString('pt-BR')}</span></>
              )}
            </Popup>
          </Marker>
        )}
        {destination && (
          <Marker position={[destination.lat, destination.lng]} icon={destIcon}>
            <Popup>📍 {destination.label || 'Destino'}</Popup>
          </Marker>
        )}
        {rider && destination && (
          <Polyline
            positions={[[rider.lat, rider.lng], [destination.lat, destination.lng]]}
            pathOptions={{ color: '#f59e0b', weight: 4, opacity: 0.8, dashArray: '8 8' }}
          />
        )}
        <FitBounds points={points} />
      </MapContainer>
    </div>
  );
};

export default LiveDeliveryMap;
