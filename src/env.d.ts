/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly PUBLIC_MAPBOX_TOKEN: string;
  readonly PUBLIC_SEGMENTATION_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
