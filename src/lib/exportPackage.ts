import JSZip from "jszip";
import type { SegmentationResult } from "./api";

export async function downloadUnityPackage(
  result: SegmentationResult,
  fileNameBase = "realmap-terrain",
): Promise<void> {
  const zip = new JSZip();

  zip.file("mask.png", result.maskBlob);
  zip.file("metadata.json", JSON.stringify(result.metadata, null, 2));

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

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
