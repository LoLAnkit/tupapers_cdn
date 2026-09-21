import sharp from "sharp";

export interface Optimized {
  data: Buffer;
  /** Output extension including the dot: ".webp" or ".svg". */
  ext: string;
  contentType: string;
  width?: number;
  height?: number;
}

export type WatermarkPosition =
  "bottom-right" | "bottom-left" | "top-right" | "top-left" | "center";

export interface OptimizeOptions {
  /** WebP quality, 1–100. */
  quality: number;
  /** Optional max-width clamp in px (never upscales). */
  maxWidth?: number;
  /** Optional watermark image Buffer. */
  watermarkBuffer?: Buffer;
  watermarkPosition?: WatermarkPosition;
}

const CONTENT_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".tiff": "image/tiff",
};

const RASTER_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".tiff"]);

const GRAVITY_MAP: Record<WatermarkPosition, string> = {
  "bottom-right": "southeast",
  "bottom-left": "southwest",
  "top-right": "northeast",
  "top-left": "northwest",
  center: "center",
};

/** Return source bytes plus metadata; used unchanged only for SVG files. */
export async function inspectImage(input: Buffer, sourceExt: string): Promise<Optimized> {
  const ext = sourceExt.toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    throw new Error(`Unsupported image type: ${ext}`);
  }

  let width: number | undefined;
  let height: number | undefined;
  try {
    const meta = await sharp(input, { failOn: "none", animated: true }).metadata();
    width = meta.width;
    height = meta.pageHeight ?? meta.height;
  } catch {
    // Keep valid-but-unreadable metadata from changing the original image bytes.
  }

  return { data: input, ext, contentType, width, height };
}

/**
 * Compress raster images locally with Sharp and apply the optional watermark.
 * SVG files stay vector files and are copied unchanged.
 */
export async function optimizeImage(
  input: Buffer,
  sourceExt: string,
  opts: OptimizeOptions,
): Promise<Optimized> {
  const ext = sourceExt.toLowerCase();
  if (ext === ".svg") return inspectImage(input, ext);
  if (!RASTER_EXT.has(ext)) throw new Error(`Unsupported image type: ${ext}`);

  let pipeline = sharp(input, { failOn: "none", animated: true }).rotate();
  const meta = await pipeline.metadata();
  const outputWidth = opts.maxWidth
    ? Math.min(meta.width ?? opts.maxWidth, opts.maxWidth)
    : (meta.width ?? 800);

  if (opts.maxWidth && opts.maxWidth > 0) {
    pipeline = pipeline.resize({ width: opts.maxWidth, withoutEnlargement: true });
  }

  if (opts.watermarkBuffer) {
    // Match the previous small watermark scale: ~14% of image width.
    const watermarkWidth = Math.min(Math.max(Math.round(outputWidth * 0.14), 50), 180);
    const watermark = await sharp(opts.watermarkBuffer)
      .resize({ width: watermarkWidth, withoutEnlargement: true })
      .png()
      .toBuffer();
    pipeline = pipeline.composite([
      {
        input: watermark,
        gravity: GRAVITY_MAP[opts.watermarkPosition ?? "bottom-right"],
      },
    ]);
  }

  const { data, info } = await pipeline
    // Effort affects encoder time, not the requested quality. Four keeps a
    // large catalog build responsive while retaining strong compression.
    .webp({ quality: opts.quality, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    ext: ".webp",
    contentType: "image/webp",
    width: info.width,
    height: info.height,
  };
}
