import type { SelectionMetadata } from "./geo";

export interface Building {
  type: string;
  height: number;
  baseElevation: number;
  footprint: Array<[number, number]>;
}

export interface Road {
  type: string;
  width: number;
  path: Array<[number, number]>;
}

export interface SegmentationResult {
  maskPng: string;
  satellitePng: string;
  heightRaw: string;
  buildings: Building[];
  roads: Road[];
  metadata: Record<string, unknown>;
}

export type SegmentationMode = "osm" | "ai" | "hybrid";

export interface SegmentationRequest {
  boundingBox: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
  };
  center: { lng: number; lat: number };
  zoom: number;
  widthMeters: number;
  heightMeters: number;
  edgeMeters: number;
  corners: Array<{ lng: number; lat: number }>;
  mode: SegmentationMode;
}

export interface SegmentationProgress {
  stage: string;
  detail?: { name: string; index: number; total: number } | null;
}

function toRequest(selection: SelectionMetadata, mode: SegmentationMode): SegmentationRequest {
  return {
    boundingBox: {
      minLng: selection.minLng,
      minLat: selection.minLat,
      maxLng: selection.maxLng,
      maxLat: selection.maxLat,
    },
    center: { lng: selection.centerLng, lat: selection.centerLat },
    zoom: selection.zoom,
    widthMeters: selection.widthMeters,
    heightMeters: selection.heightMeters,
    edgeMeters: selection.edgeMeters,
    corners: selection.corners,
    mode,
  };
}

const API_URL = import.meta.env.PUBLIC_SEGMENTATION_API_URL;

/**
 * Posts the selection to the segmentation backend and streams progress via
 * Server-Sent Events. `onProgress` fires for each `progress` event; the promise
 * resolves with the final `result` payload. Falls back to a single JSON
 * response if the backend does not stream.
 */
export async function requestSegmentation(
  selection: SelectionMetadata,
  mode: SegmentationMode = "osm",
  onProgress?: (progress: SegmentationProgress) => void,
  signal?: AbortSignal,
): Promise<SegmentationResult> {
  if (!API_URL) {
    throw new Error(
      "PUBLIC_SEGMENTATION_API_URL is not configured. Set it in your .env file.",
    );
  }

  const payload = toRequest(selection, mode);

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new Error(
      "Could not reach the segmentation API (network or CORS). The API only accepts requests from the production origin (realmap.jonasludorf.dev).",
    );
  }

  if (!response.ok || !response.body) {
    const detail = await parseError(response);
    throw new Error(
      `Segmentation request failed (${response.status}). ${detail}`.trim(),
    );
  }

  const contentType = response.headers.get("Content-Type") ?? "";

  // Non-streaming fallback: a single JSON response.
  if (!contentType.includes("text/event-stream")) {
    const data = (await response.json()) as Partial<SegmentationResult>;
    return normalizeResult(data, payload);
  }

  // SSE stream: frames separated by a blank line, each with `event:`/`data:`.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: SegmentationResult | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const raw = /^data: (.+)$/m.exec(frame)?.[1];
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (event === "progress") {
        onProgress?.(data as SegmentationProgress);
      } else if (event === "result") {
        result = normalizeResult(data as Partial<SegmentationResult>, payload);
      } else if (event === "error") {
        throw new Error(data.error ?? "Segmentation failed.");
      }
    }
  }

  if (!result) throw new Error("Stream ended without a result.");
  return result;
}

function normalizeResult(
  data: Partial<SegmentationResult>,
  payload: SegmentationRequest,
): SegmentationResult {
  if (!data.maskPng) {
    throw new Error("Backend response is missing the `maskPng` field.");
  }
  return {
    maskPng: data.maskPng,
    satellitePng: data.satellitePng ?? "",
    heightRaw: data.heightRaw ?? "",
    buildings: data.buildings ?? [],
    roads: data.roads ?? [],
    metadata: { ...payload, ...(data.metadata ?? {}) },
  };
}

async function parseError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text) as { error?: string };
      return json.error ?? text;
    } catch {
      return text;
    }
  } catch {
    return "";
  }
}
