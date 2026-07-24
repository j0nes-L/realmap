import type { Map as MapboxMap } from "mapbox-gl";

export interface BoundingBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface SelectionMetadata extends BoundingBox {
  centerLng: number;
  centerLat: number;
  zoom: number;
  widthMeters: number;
  heightMeters: number;
  edgeMeters: number;
  corners: Array<{ lng: number; lat: number }>;
}

const EARTH_RADIUS_M = 6_371_008.8;

function haversineMeters(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface SquareRect {
  left: number;
  top: number;
  size: number;
}

export function readSelection(
  map: MapboxMap,
  rect: SquareRect,
): SelectionMetadata {
  const left = rect.left;
  const top = rect.top;
  const right = left + rect.size;
  const bottom = top + rect.size;

  const topLeft = map.unproject([left, top]);
  const topRight = map.unproject([right, top]);
  const bottomRight = map.unproject([right, bottom]);
  const bottomLeft = map.unproject([left, bottom]);

  const corners = [topLeft, topRight, bottomRight, bottomLeft].map((c) => ({
    lng: c.lng,
    lat: c.lat,
  }));

  const lngs = corners.map((c) => c.lng);
  const lats = corners.map((c) => c.lat);

  const widthMeters = haversineMeters(corners[0], corners[1]);
  const heightMeters = haversineMeters(corners[0], corners[3]);

  return {
    minLng: Math.min(...lngs),
    minLat: Math.min(...lats),
    maxLng: Math.max(...lngs),
    maxLat: Math.max(...lats),
    centerLng: map.getCenter().lng,
    centerLat: map.getCenter().lat,
    zoom: map.getZoom(),
    widthMeters,
    heightMeters,
    edgeMeters: (widthMeters + heightMeters) / 2,
    corners,
  };
}
