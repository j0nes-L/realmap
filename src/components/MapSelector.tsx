import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { readSelection, type SelectionMetadata, type SquareRect } from "../lib/geo";
import { geocode, type GeocodeResult } from "../lib/geocode";
import { requestSegmentation, type SegmentationProgress } from "../lib/api";
import { downloadUnityPackage } from "../lib/exportPackage";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

const RESERVE_TOP = 128;
const RESERVE_BOTTOM = 184;
const SIDE_MARGIN = 24;
const FRAME_SIZE = 512;
const GEODATA_MIN_ZOOM = 12.5;

function computeSquare(el: HTMLElement): SquareRect {
  const w = el.clientWidth;
  const h = el.clientHeight;
  const bandTop = RESERVE_TOP;
  const bandBottom = h - RESERVE_BOTTOM;
  const bandHeight = Math.max(0, bandBottom - bandTop);
  const maxWidth = Math.max(0, w - SIDE_MARGIN * 2);
  const size = Math.floor(Math.min(FRAME_SIZE, maxWidth, bandHeight));
  const left = Math.round((w - size) / 2);
  const top = Math.round(bandTop + (bandHeight - size) / 2);
  return { left, top, size };
}

export default function MapSelector() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const skipSearchRef = useRef(false);

  const [square, setSquare] = useState<SquareRect>({ left: 0, top: 0, size: 0 });
  const [selection, setSelection] = useState<SelectionMetadata | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [resultsOpen, setResultsOpen] = useState(false);

  const token = import.meta.env.PUBLIC_MAPBOX_TOKEN;
  const busy = status.kind === "loading";
  const lowZoom = selection ? selection.zoom < GEODATA_MIN_ZOOM : false;

  useEffect(() => {
    if (status.kind !== "done") return;
    const handle = window.setTimeout(() => {
      setStatus({ kind: "idle" });
    }, 6000);
    return () => window.clearTimeout(handle);
  }, [status]);

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
      minZoom: 9.5,
      maxZoom: 16,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-left");
    mapRef.current = map;

    const refreshOverlaySize = () => {
      const el = mapContainerRef.current;
      if (!el) return;
      setSquare(computeSquare(el));
    };

    const updateSelection = () => {
      const el = mapContainerRef.current;
      if (!el) return;
      setSelection(readSelection(map, computeSquare(el)));
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
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }
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
    skipSearchRef.current = true;
    setQuery(result.name);
    setResults([]);
    setResultsOpen(false);
    map.jumpTo({
      center: [result.lng, result.lat],
      zoom: Math.min(Math.max(map.getZoom(), 15), 18),
    });
  };

  const handleGenerate = async () => {
    const map = mapRef.current;
    const el = mapContainerRef.current;
    if (!map || !el || busy) return;

    const current = readSelection(map, computeSquare(el));
    setSelection(current);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus({ kind: "loading", message: "Segmenting…" });
    try {
      const result = await requestSegmentation(
        current,
        (progress) => {
          setStatus({ kind: "loading", message: progressMessage(progress) });
        },
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
      <div ref={mapContainerRef} className="h-full w-full" />

      {status.kind === "done" && (
        <div className="toast-enter pointer-events-none absolute right-4 top-4 z-20 max-w-[min(92vw,360px)] rounded-lg border border-emerald-400/30 bg-stone-900/90 px-4 py-3 text-sm text-emerald-300 shadow-xl backdrop-blur">
          {status.message}
        </div>
      )}

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

      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute border-2 border-amber-300/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{ left: square.left, top: square.top, width: square.size, height: square.size }}
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

        {lowZoom && (
          <p className="mt-2 text-sm text-amber-400">
            Under zoom {GEODATA_MIN_ZOOM} only the relief / textures are exported.
          </p>
        )}
        {status.kind === "error" && (
          <p className="mt-2 text-sm text-red-400">{status.message}</p>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="uppercase tracking-wide text-[10px] text-stone-500">{label}</div>
      <div className="truncate whitespace-nowrap font-mono text-stone-100">{value}</div>
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

function progressMessage(progress: SegmentationProgress): string {
  switch (progress.stage) {
    case "imagery":
      return "Fetching satellite imagery…";
    case "dem":
      return "Loading elevation data…";
    case "osm":
      return "Loading map features…";
    case "heightmap":
      return "Building heightmap…";
    default:
      return "Processing…";
  }
}

function formatMeters(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}
