export interface GeocodeResult {
  id: string;
  name: string;
  fullName: string;
  lng: number;
  lat: number;
}

interface GeocodeFeature {
  id: string;
  properties?: {
    name?: string;
    name_preferred?: string;
    place_formatted?: string;
    full_address?: string;
    coordinates?: { longitude: number; latitude: number };
  };
  geometry?: { coordinates?: [number, number] };
}

export async function geocode(
  query: string,
  token: string,
  signal?: AbortSignal,
  limit = 5,
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = new URL("https://api.mapbox.com/search/searchbox/v1/forward");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("access_token", token);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("language", navigator.language.split("-")[0] || "en");

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Geocoding failed (${response.status}).`);
  }

  const data = (await response.json()) as { features?: GeocodeFeature[] };
  const features = data.features ?? [];

  return features
    .map((feature): GeocodeResult | null => {
      const coords =
        feature.geometry?.coordinates ??
        (feature.properties?.coordinates
          ? [
              feature.properties.coordinates.longitude,
              feature.properties.coordinates.latitude,
            ]
          : undefined);
      if (!coords) return null;

      const name =
        feature.properties?.name_preferred ??
        feature.properties?.name ??
        feature.properties?.place_formatted ??
        "Unknown";
      const fullName =
        feature.properties?.full_address ??
        feature.properties?.place_formatted ??
        name;

      return {
        id: feature.id,
        name,
        fullName,
        lng: coords[0],
        lat: coords[1],
      };
    })
    .filter((r): r is GeocodeResult => r !== null);
}
