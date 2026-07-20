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

export interface Area {
  class: string;
  polygon: Array<[number, number]>;
}

export interface SegmentationResult {
  maskPng: string;
  satellitePng: string;
  heightRaw: string;
  buildings: Building[];
  roads: Road[];
  areas: Area[];
  metadata: Record<string, unknown>;
}

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
}

export interface ProgressEvent {
  stage: "imagery" | "dem" | "osm" | "heightmap";
  detail: string | null;
}

function toRequest(selection: SelectionMetadata): SegmentationRequest {
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
  };
}

const API_URL = import.meta.env.PUBLIC_SEGMENTATION_API_URL;

export async function requestSegmentation(
  selection: SelectionMetadata,
  onProgress?: (event: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<SegmentationResult> {
  if (!API_URL) {
    throw new Error(
      "PUBLIC_SEGMENTATION_API_URL is not configured. Set it in your .env file.",
    );
  }

  const requestBody = toRequest(selection);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Segmentation request failed (${response.status}). ${detail}`.trim(),
    );
  }

  const contentType = response.headers.get("Content-Type") ?? "";

  if (contentType.includes("text/event-stream") && response.body) {
    const result = await readEventStream(response.body, onProgress);
    return { ...result, metadata: { ...requestBody, ...result.metadata } };
  }

  const data = (await response.json()) as SegmentationResult;
  return { ...data, metadata: { ...requestBody, ...(data.metadata ?? {}) } };
}

async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: (event: ProgressEvent) => void,
): Promise<SegmentationResult> {
  const reader = body.getReader();
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
      const eventMatch = /^event: (.+)$/m.exec(frame);
      const dataMatch = /^data: (.+)$/m.exec(frame);
      if (!eventMatch || !dataMatch) continue;

      const event = eventMatch[1].trim();
      const data = JSON.parse(dataMatch[1]);

      if (event === "progress") {
        onProgress?.(data as ProgressEvent);
      } else if (event === "result") {
        result = data as SegmentationResult;
      } else if (event === "error") {
        throw new Error(data.error ?? "Segmentation stream reported an error.");
      }
    }
  }

  if (!result) {
    throw new Error("Stream ended without a result.");
  }
  return result;
}
