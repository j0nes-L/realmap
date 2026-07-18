import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { readSelection, type SelectionMetadata } from "../lib/geo";
import { requestSegmentation } from "../lib/api";
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

  const [squareSize, setSquareSize] = useState(0);
  const [selection, setSelection] = useState<SelectionMetadata | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const token = import.meta.env.PUBLIC_MAPBOX_TOKEN;
  const busy = status.kind === "loading";

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    if (!token) {
      setStatus({
        kind: "error",
        message:
          "Missing PUBLIC_MAPBOX_TOKEN. Add it to your .env file and restart the dev server.",
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
      const result = await requestSegmentation(current, controller.signal);
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

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="relative border-2 border-cyan-300/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{ width: squareSize, height: squareSize }}
          aria-hidden="true"
        >
          <span className="absolute -left-0.5 -top-0.5 h-4 w-4 border-l-2 border-t-2 border-cyan-200" />
          <span className="absolute -right-0.5 -top-0.5 h-4 w-4 border-r-2 border-t-2 border-cyan-200" />
          <span className="absolute -bottom-0.5 -left-0.5 h-4 w-4 border-b-2 border-l-2 border-cyan-200" />
          <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 border-b-2 border-r-2 border-cyan-200" />
        </div>
      </div>

      <div className="pointer-events-auto absolute bottom-4 left-1/2 w-[min(92vw,520px)] -translate-x-1/2 rounded-xl border border-white/10 bg-slate-900/80 p-4 backdrop-blur">
        <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-300 sm:grid-cols-4">
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
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Spinner />}
          {busy ? statusMessage(status) : "Generate terrain"}
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
      <div className="uppercase tracking-wide text-[10px] text-slate-500">{label}</div>
      <div className="font-mono text-slate-100">{value}</div>
    </div>
  );
}

function Spinner() {
  return (
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950/40 border-t-slate-950" />
  );
}

function statusMessage(status: Status): string {
  return status.kind === "loading" ? status.message : "Generate terrain";
}

function formatMeters(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}
