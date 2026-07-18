# RealMap

Astro-Frontend, um einen **quadratischen** Kartenausschnitt (Satellitenbild) auszuwählen und
als Unity-Terrain-Paket (`.zip` aus `mask.png` + `metadata.json`) zu exportieren.

## Architektur

- **Astro** liefert statisches HTML; nur die Karte lädt JavaScript (Islands Architecture).
- **React-Island** `MapSelector.tsx`, eingebunden mit `client:only="react"`
  (Mapbox greift auf `window` zu und darf nicht per SSR laufen).
- **Tailwind CSS v4** über das Vite-Plugin für UI/Overlays/Buttons.
- **Feste Quadrat-Auswahl:** Der Rahmen ist fixiert und zentriert; die Karte wird
  darunter verschoben. Beim Export werden die Bildschirm-Pixel des Rahmens per
  `map.unproject()` in Koordinaten umgerechnet.

## Setup

1. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
2. `.env` befüllen (siehe `.env.example`):
   - `PUBLIC_MAPBOX_TOKEN` – öffentlicher Mapbox-Token (`pk.…`).
   - `PUBLIC_SEGMENTATION_API_URL` – Endpunkt (API oder Modal-Webhook, muss CORS erlauben).
3. Entwicklungsserver starten:
   ```bash
   npm run dev
   ```

## Backend-Vertrag

`POST` an `PUBLIC_SEGMENTATION_API_URL` mit JSON:

```jsonc
{
  "boundingBox": { "minLng": 0, "minLat": 0, "maxLng": 0, "maxLat": 0 },
  "center": { "lng": 0, "lat": 0 },
  "zoom": 14.0,
  "widthMeters": 0,
  "heightMeters": 0,
  "edgeMeters": 0,            // Unity nutzt dies zum Skalieren des Terrains
  "corners": [ { "lng": 0, "lat": 0 } ]
}
```

Antwort – eine der beiden Varianten:

- **JSON:** `{ "maskPng": "<base64>", "metadata": { ... } }`
- **Binär:** `image/png` im Body, Metadaten als JSON-String im Header
  `X-Segmentation-Metadata`.

Das Frontend bündelt Maske + Metadaten mit `jszip` zu einem `.zip`, das per
Drag & Drop in den Unity-Editor-Importer gezogen werden kann.

## Skripte

| Befehl            | Beschreibung                     |
| ----------------- | -------------------------------- |
| `npm run dev`     | Dev-Server (`localhost:4321`)    |
| `npm run build`   | Produktions-Build nach `dist/`   |
| `npm run preview` | Build lokal vorschauen           |
