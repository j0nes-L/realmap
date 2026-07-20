import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { readSelection, type SelectionMetadata } from "../lib/geo";
import { geocode, type GeocodeResult } from "../lib/geocode";
import { requestSegmentation, type ProgressEvent } from "../lib/api";
import { downloadUnityPackage } from "../lib/exportPackage";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

const OVERLAY_RATIO = 0.75;

export default function MapSelector() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const [squareSize, setSquareSize] = useState(0);
  const [selection, setSelection] = useState<SelectionMetadata | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [resultsOpen, setResultsOpen] = useState(false);

  const token = import.meta.env.PUBLIC_MAPBOX_TOKEN;
  const busy = status.kind === "loading";

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    if (!token) {
      setStatus({
        kind: "error",
        message:
          "Missing PUBLIC_MAPBOX_TOKEN.",
      });
      return;
    }

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/satellite-v9",
      center: [13.405, 52.52],
      zoom: 14,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-left");
    mapRef.current = map;

    const refreshOverlaySize = () => {
      const el = mapContainerRef.current;
      if (!el) return;
      setSquareSize(
        Math.round(Math.min(el.clientWidth, el.clientHeight) * OVERLAY_RATIO),
      );
    };

    const updateSelection = () => {
      const el = mapContainerRef.current;
      if (!el) return;
      const size = Math.round(
        Math.min(el.clientWidth, el.clientHeight) * OVERLAY_RATIO,
      );
      setSelection(readSelection(map, size));
    };

    map.on("load", () => {
      refreshOverlaySize();
      updateSelection();
    });
    map.on("move", updateSelection);
    map.on("resize", refreshOverlaySize);

    const onWindowResize = () => refreshOverlaySize();
    window.addEventListener("resize", onWindowResize);

    return () => {
      window.removeEventListener("resize", onWindowResize);
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    const handle = window.setTimeout(async () => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const found = await geocode(trimmed, token, controller.signal);
        setResults(found);
        setResultsOpen(true);
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") setResults([]);
      }
    }, 300);

    return () => window.clearTimeout(handle);
  }, [query, token]);

  const handleSelectResult = (result: GeocodeResult) => {
    const map = mapRef.current;
    if (!map) return;
    setQuery(result.name);
    setResultsOpen(false);
    map.flyTo({
      center: [result.lng, result.lat],
      zoom: Math.max(map.getZoom(), 15),
      essential: true,
    });
  };

  const handleGenerate = async () => {
    const map = mapRef.current;
    if (!map || busy) return;

    const current = readSelection(map, squareSize);
    setSelection(current);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus({ kind: "loading", message: "Segmenting…" });
    try {
      const result = await requestSegmentation(
        current,
        (event) => setStatus({ kind: "loading", message: progressMessage(event) }),
        controller.signal,
      );
      setStatus({ kind: "loading", message: "Bundling package…" });
      await downloadUnityPackage(result);
      setStatus({ kind: "done", message: "Download ready – Unity package created." });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setStatus({
        kind: "error",
        message: (err as Error)?.message ?? "Unknown error.",
      });
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="absolute inset-0" />

      <div className="pointer-events-auto absolute left-1/2 top-4 z-10 w-[min(92vw,420px)] -translate-x-1/2">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setResultsOpen(true)}
            placeholder="Search for a place or address…"
            className="w-full rounded-lg border border-white/10 bg-stone-900/85 px-4 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 shadow-lg outline-none backdrop-blur focus:border-amber-400/70"
          />
          {resultsOpen && results.length > 0 && (
            <ul className="absolute mt-1 max-h-64 w-full overflow-auto rounded-lg border border-white/10 bg-stone-900/95 py-1 shadow-xl backdrop-blur">
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectResult(result)}
                    className="block w-full px-4 py-2 text-left text-sm text-stone-200 hover:bg-amber-500/15"
                  >
                    <span className="font-medium">{result.name}</span>
                    <span className="block truncate text-xs text-stone-400">
                      {result.fullName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="relative border-2 border-amber-300/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{ width: squareSize, height: squareSize }}
          aria-hidden="true"
        >
          <span className="absolute -left-0.5 -top-0.5 h-4 w-4 border-l-2 border-t-2 border-amber-200" />
          <span className="absolute -right-0.5 -top-0.5 h-4 w-4 border-r-2 border-t-2 border-amber-200" />
          <span className="absolute -bottom-0.5 -left-0.5 h-4 w-4 border-b-2 border-l-2 border-amber-200" />
          <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 border-b-2 border-r-2 border-amber-200" />
        </div>
      </div>

      <div className="pointer-events-auto absolute bottom-4 left-1/2 w-[min(92vw,520px)] -translate-x-1/2 rounded-xl border border-white/10 bg-stone-900/80 p-4 backdrop-blur">
        <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-stone-300 sm:grid-cols-4">
          <Metric label="Edge length" value={selection ? `${formatMeters(selection.edgeMeters)}` : "–"} />
          <Metric label="Zoom" value={selection ? selection.zoom.toFixed(2) : "–"} />
          <Metric
            label="Center"
            value={
              selection
                ? `${selection.centerLat.toFixed(4)}, ${selection.centerLng.toFixed(4)}`
                : "–"
            }
          />
          <Metric
            label="Area"
            value={
              selection
                ? `${formatMeters(selection.widthMeters)} × ${formatMeters(selection.heightMeters)}`
                : "–"
            }
          />
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy || !selection}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 font-semibold text-stone-950 shadow-sm transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400 disabled:shadow-none"
        >
          {busy && <Spinner />}
          {busy ? statusMessage(status) : "Export Terrain"}
        </button>

        {status.kind === "error" && (
          <p className="mt-2 text-sm text-red-400">{status.message}</p>
        )}
        {status.kind === "done" && (
          <p className="mt-2 text-sm text-emerald-400">{status.message}</p>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="uppercase tracking-wide text-[10px] text-stone-500">{label}</div>
      <div className="font-mono text-stone-100">{value}</div>
    </div>
  );
}

function Spinner() {
  return (
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/40 border-t-current" />
  );
}

function statusMessage(status: Status): string {
  return status.kind === "loading" ? status.message : "Generate terrain";
}

function progressMessage(event: ProgressEvent): string {
  switch (event.stage) {
    case "imagery":
      return "Fetching satellite imagery…";
    case "dem":
      return "Fetching elevation data…";
    case "osm":
      return "Fetching OpenStreetMap data…";
    case "heightmap":
      return "Building heightmap…";
    default:
      return "Segmenting…";
  }
}

function formatMeters(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}
