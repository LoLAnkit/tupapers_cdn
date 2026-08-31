import sharp from "sharp";
import { optimize as svgoOptimize } from "svgo";

export interface Optimized {
  data: Buffer;
  /** Output extension including the dot: ".webp" or ".svg". */
  ext: string;
  contentType: string;
  width?: number;
  height?: number;
}

export type WatermarkPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left"
  | "center";

export interface OptimizeOptions {
  /** graphic = near-lossless (diagrams/figures); photo = lossy q78. */
  mode: "graphic" | "photo";
  /** Optional max-width clamp in px (never upscales). */
  maxWidth?: number;
  /** Optional watermark image Buffer. */
  watermarkBuffer?: Buffer;
  /** Watermark position on image. Defaults to "bottom-right". */
  watermarkPosition?: WatermarkPosition;
}

const RASTER_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".tiff"]);

const GRAVITY_MAP: Record<WatermarkPosition, string> = {
  "bottom-right": "southeast",
  "bottom-left": "southwest",
  "top-right": "northeast",
  "top-left": "northwest",
  center: "center",
};

/**
 * Normalize + convert an image to optimized bytes.
 * - Raster → WebP (metadata stripped, auto-oriented, watermarked if configured).
 * - SVG    → svgo-optimized SVG (never rasterized).
 */
export async function optimizeImage(
  input: Buffer,
  sourceExt: string,
  opts: OptimizeOptions,
): Promise<Optimized> {
  const ext = sourceExt.toLowerCase();

  if (ext === ".svg") {
    const result = svgoOptimize(input.toString("utf8"), { multipass: true });
    const data = Buffer.from(result.data, "utf8");
    let width: number | undefined;
    let height: number | undefined;
    try {
      const meta = await sharp(data).metadata();
      width = meta.width;
      height = meta.height;
    } catch {
      // dimensionless SVG — leave width/height undefined
    }
    return { data, ext: ".svg", contentType: "image/svg+xml", width, height };
  }

  if (!RASTER_EXT.has(ext)) {
    throw new Error(`Unsupported image type: ${ext}`);
  }

  let pipeline = sharp(input, { failOn: "none" }).rotate(); // auto-orient via EXIF
  if (opts.maxWidth && opts.maxWidth > 0) {
    pipeline = pipeline.resize({ width: opts.maxWidth, withoutEnlargement: true });
  }

  if (opts.watermarkBuffer) {
    const meta = await pipeline.metadata();
    const baseWidth = meta.width ?? 800;

    // Scale watermark to ~14% of base image width (bounded between 50px and 180px)
    const targetWmWidth = Math.min(Math.max(Math.round(baseWidth * 0.14), 50), 180);

    const resizedWatermark = await sharp(opts.watermarkBuffer)
      .resize({ width: targetWmWidth, withoutEnlargement: true })
      .toBuffer();

    const position = opts.watermarkPosition ?? "bottom-right";
    const gravity = GRAVITY_MAP[position] || "southeast";

    pipeline = pipeline.composite([
      {
        input: resizedWatermark,
        gravity,
      },
    ]);
  }

  const webpOptions =
    opts.mode === "photo"
      ? { quality: 78, effort: 5 }
      : { nearLossless: true, quality: 90, effort: 5 };

  const { data, info } = await pipeline.webp(webpOptions).toBuffer({ resolveWithObject: true });

  return {
    data,
    ext: ".webp",
    contentType: "image/webp",
    width: info.width,
    height: info.height,
  };
}
