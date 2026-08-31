import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root (the folder containing src/, source/, dist/). */
export const ROOT = path.resolve(__dirname, "..");

/** Raw input images live here, mirroring the bucket taxonomy. */
export const SOURCE_DIR = path.join(ROOT, "source");

/** Optimized, content-hashed files are written here before upload. */
export const DIST_DIR = path.join(ROOT, "dist");

/**
 * Sharded manifest files live here.
 * manifests/
 *   index.json
 *   course.bca.first-semester.json
 *   course.csit.third-semester.json
 *   ...
 */
export const MANIFEST_DIR = path.join(ROOT, "manifests");

/** Default watermark image path in root directory. */
export const DEFAULT_WATERMARK_PATH = path.join(ROOT, "watermark.webp");

/** Legacy flat manifest — kept during migration, written alongside shards. */
export const MANIFEST_PATH = path.join(ROOT, "manifest.json");

/** Immutable cache header for content-addressed assets. */
export const CACHE_CONTROL = "public, max-age=31536000, immutable";

/** manifest.json changes over time, so it must NOT be cached forever. */
export const MANIFEST_CACHE_CONTROL = "public, max-age=60, must-revalidate";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("<") || value.startsWith("xxxx")) {
    throw new Error(
      `Missing/placeholder env var: ${name}. Copy .env.example → .env and fill in real values.`,
    );
  }
  return value;
}

export interface R2Config {
  accountId: string;
  bucket: string;
  cdnBase: string;
  endpoint: string;
  client: S3Client;
}

let cached: R2Config | null = null;

/**
 * Build (and cache) the R2 S3 client. Only called by commands that touch the
 * network (upload / prune) so `build` works offline without credentials.
 */
export function getR2(): R2Config {
  if (cached) return cached;

  const accountId = required("R2_ACCOUNT_ID");
  const accessKeyId = required("R2_ACCESS_KEY_ID");
  const secretAccessKey = required("R2_SECRET_ACCESS_KEY");
  const bucket = required("R2_BUCKET");
  const cdnBase = required("CDN_BASE").replace(/\/+$/, "");
  const endpoint =
    process.env.R2_ENDPOINT && !process.env.R2_ENDPOINT.includes("<")
      ? process.env.R2_ENDPOINT
      : `https://${accountId}.r2.cloudflarestorage.com`;

  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  cached = { accountId, bucket, cdnBase, endpoint, client };
  return cached;
}

/** CDN base for the manifest during `build` (no credentials required). */
export function cdnBaseOnly(): string {
  return (process.env.CDN_BASE ?? "https://cdn.tupapers.com").replace(/\/+$/, "");
}

/** Worker count for parallel optimize/upload. */
export function concurrency(): number {
  const n = Number(process.env.CONCURRENCY);
  return Number.isFinite(n) && n > 0 ? n : 6;
}
