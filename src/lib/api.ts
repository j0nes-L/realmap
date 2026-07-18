import type { SelectionMetadata } from "./geo";

export interface SegmentationResult {
  maskBlob: Blob;
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
  signal?: AbortSignal,
): Promise<SegmentationResult> {
  if (!API_URL) {
    throw new Error(
      "PUBLIC_SEGMENTATION_API_URL is not configured. Set it in your .env file.",
    );
  }

  const payload = toRequest(selection);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Segmentation request failed (${response.status}). ${detail}`.trim(),
    );
  }

  const contentType = response.headers.get("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    const data = (await response.json()) as {
      maskPng?: string;
      metadata?: Record<string, unknown>;
    };
    if (!data.maskPng) {
      throw new Error("Backend response is missing the `maskPng` field.");
    }
    return {
      maskBlob: base64ToBlob(data.maskPng, "image/png"),
      metadata: { ...payload, ...(data.metadata ?? {}) },
    };
  }

  const maskBlob = await response.blob();
  const headerMeta = response.headers.get("X-Segmentation-Metadata");
  let backendMeta: Record<string, unknown> = {};
  if (headerMeta) {
    try {
      backendMeta = JSON.parse(headerMeta);
    } catch {
    }
  }

  return { maskBlob, metadata: { ...payload, ...backendMeta } };
}

function base64ToBlob(base64: string, mime: string): Blob {
  const clean = base64.includes(",") ? base64.split(",")[1] : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
