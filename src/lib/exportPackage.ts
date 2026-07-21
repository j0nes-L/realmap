import JSZip from "jszip";
import type { SegmentationResult } from "./api";

export async function downloadUnityPackage(
  result: SegmentationResult,
  fileNameBase = "realmap-terrain",
): Promise<void> {
  const zip = new JSZip();
  const fileOptions = { date: toZipLocalDate(new Date()) };

  zip.file("mask.png", base64ToBytes(result.maskPng), fileOptions);
  if (result.satellitePng) {
    zip.file("satellite.png", base64ToBytes(result.satellitePng), fileOptions);
  }
  if (result.heightRaw) {
    zip.file("height.raw", base64ToBytes(result.heightRaw), fileOptions);
  }
  zip.file("buildings.json", JSON.stringify(result.buildings, null, 2), fileOptions);
  zip.file("roads.json", JSON.stringify(result.roads, null, 2), fileOptions);
  zip.file("areas.json", JSON.stringify(result.areas, null, 2), fileOptions);
  zip.file("metadata.json", JSON.stringify(result.metadata, null, 2), fileOptions);

  const archive = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const url = URL.createObjectURL(archive);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileNameBase}-${timestamp()}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.includes(",") ? base64.split(",")[1] : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function toZipLocalDate(date: Date): Date {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000);
}
