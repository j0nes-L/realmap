# RealMap

Astro frontend to select a **square** map region (satellite imagery) and export it
as a Unity terrain package (`.zip` containing `mask.png` + `metadata.json`).

## Architecture

- **Astro** serves static HTML; only the map loads JavaScript (Islands Architecture).
- **React island** `MapSelector.tsx`, mounted with `client:only="react"`
  (Mapbox accesses `window` and must not run during SSR).
- **Tailwind CSS v4** via the Vite plugin for UI/overlays/buttons.
- **Fixed square selection:** the frame is fixed and centered; the map moves
  underneath it. On export, the frame's screen pixels are converted to
  coordinates via `map.unproject()`.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Fill in `.env` (see `.env.example`):
   - `PUBLIC_MAPBOX_TOKEN` – public Mapbox token (`pk.…`).
   - `PUBLIC_SEGMENTATION_API_URL` – endpoint (API or Modal webhook, must allow CORS).
3. Start the dev server:
   ```bash
   npm run dev
   ```

## Backend contract

`POST` to `PUBLIC_SEGMENTATION_API_URL` with JSON:

```jsonc
{
  "boundingBox": { "minLng": 0, "minLat": 0, "maxLng": 0, "maxLat": 0 },
  "center": { "lng": 0, "lat": 0 },
  "zoom": 14.0,
  "widthMeters": 0,
  "heightMeters": 0,
  "edgeMeters": 0,            // Unity uses this to scale the terrain
  "corners": [ { "lng": 0, "lat": 0 } ]
}
```

Response – one of two variants:

- **JSON:** `{ "maskPng": "<base64>", "metadata": { ... } }`
- **Binary:** `image/png` in the body, metadata as a JSON string in the
  `X-Segmentation-Metadata` header.

The frontend bundles the mask + metadata into a `.zip` using `jszip`, which can
be dragged and dropped into the Unity editor importer.

## Deployment

Deployed as a static site on Vercel (zero-config; auto-detected as Astro).
The custom domain is `realmap.jonasludorf.dev`. Set `PUBLIC_MAPBOX_TOKEN` and
`PUBLIC_SEGMENTATION_API_URL` as environment variables in the Vercel project.

## Scripts

| Command           | Description                     |
| ----------------- | ------------------------------- |
| `npm run dev`     | Dev server (`localhost:4321`)   |
| `npm run build`   | Production build to `dist/`     |
| `npm run preview` | Preview the build locally       |
