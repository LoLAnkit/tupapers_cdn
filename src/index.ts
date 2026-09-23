#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Command } from "commander";
import pLimit from "p-limit";
import {
  DIST_DIR,
  SOURCE_DIR,
  DEFAULT_WATERMARK_PATH,
  SHARP_BUILD_CACHE_PATH,
  CACHE_CONTROL,
  MUTABLE_ASSET_CACHE_CONTROL,
  cdnBaseOnly,
  concurrency,
  getR2,
} from "./config.js";
import { discover } from "./discover.js";
import {
  inspectImage,
  optimizeImage,
  type OptimizeOptions,
  type WatermarkPosition,
} from "./optimize.js";
import { buildNormalKey, logicalKeyForOutput } from "./keys.js";
import {
  writeFolderManifests,
  cleanupLegacyManifests,
  collectFolderUploadTargets,
  type AssetEntry,
} from "./manifest.js";
import { uploadObject } from "./upload.js";
import { listAllObjects, prune } from "./prune.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function contentTypeFor(key: string): string {
  return CONTENT_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

function isContentHashed(entry: AssetEntry): boolean {
  return entry.contentHashed ?? /\.[0-9a-f]{8}\.[^./]+$/i.test(entry.key);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

interface BuildOpts {
  quality: number;
  maxWidth?: number;
  watermarkPath?: string;
  noWatermark: boolean;
  watermarkPosition: WatermarkPosition;
  force: boolean;
  adoptExisting: boolean;
  verbose: boolean;
}

interface SharpBuildCacheEntry {
  sourceRelPath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  signature: string;
  asset: AssetEntry;
}

interface SharpBuildCache {
  version: 1;
  entries: Record<string, SharpBuildCacheEntry>;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function readBuildCache(): Promise<SharpBuildCache> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(SHARP_BUILD_CACHE_PATH, "utf8"),
    ) as Partial<SharpBuildCache>;
    if (parsed.version === 1 && parsed.entries && typeof parsed.entries === "object") {
      return { version: 1, entries: parsed.entries } as SharpBuildCache;
    }
  } catch {
    // First run or stale/unreadable cache: rebuild affected images safely.
  }
  return { version: 1, entries: {} };
}

async function writeBuildCache(cache: SharpBuildCache): Promise<void> {
  const sortedEntries = Object.fromEntries(
    Object.entries(cache.entries).sort(([left], [right]) => left.localeCompare(right)),
  );
  const tempPath = `${SHARP_BUILD_CACHE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(
    tempPath,
    `${JSON.stringify({ version: 1, entries: sortedEntries }, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(tempPath, SHARP_BUILD_CACHE_PATH);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseQuality(value: string): number {
  const quality = Number(value);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error(`--quality must be an integer from 1 to 100 (got "${value}")`);
  }
  return quality;
}

function parsePosition(value: string): WatermarkPosition {
  const positions: WatermarkPosition[] = [
    "bottom-right",
    "bottom-left",
    "top-right",
    "top-left",
    "center",
  ];
  if (!positions.includes(value as WatermarkPosition)) {
    throw new Error(`Invalid watermark position: ${value}`);
  }
  return value as WatermarkPosition;
}

async function runBuild(opts: BuildOpts): Promise<void> {
  const cdnBase = cdnBaseOnly();
  const files = await discover(SOURCE_DIR);

  if (files.length === 0) {
    console.warn(`⚠  No source images found under ${path.relative(process.cwd(), SOURCE_DIR)}/`);
    return;
  }

  let watermarkBuffer: Buffer | undefined;
  if (!opts.noWatermark) {
    const watermarkPath = opts.watermarkPath ?? DEFAULT_WATERMARK_PATH;
    try {
      watermarkBuffer = await fs.readFile(watermarkPath);
    } catch {
      throw new Error(`Watermark file not found: ${watermarkPath}`);
    }
  }

  const optimizeOpts: OptimizeOptions = {
    quality: opts.quality,
    maxWidth: opts.maxWidth,
    watermarkBuffer,
    watermarkPosition: opts.watermarkPosition,
  };
  const buildSignature = JSON.stringify({
    encoder: "sharp-webp-v1",
    cdnBase,
    quality: opts.quality,
    maxWidth: opts.maxWidth ?? null,
    watermark: watermarkBuffer ? sha256(watermarkBuffer) : null,
    watermarkPosition: opts.watermarkPosition,
  });
  const cache = await readBuildCache();

  const limit = pLimit(concurrency());
  let built = 0;
  let skipped = 0;
  let adopted = 0;
  let superseded = 0;
  let totalBytes = 0;
  const allAssets: Record<string, AssetEntry> = {};

  const plans = files.map((file) => {
    const sourceExt = path.extname(file.absPath).toLowerCase();
    const sourceKey = buildNormalKey(file.relPath, sourceExt);
    const canonicalSource = logicalKeyForOutput(sourceKey) !== sourceKey;
    const outputExt = sourceExt === ".svg" ? ".svg" : ".webp";
    const outputKey = logicalKeyForOutput(buildNormalKey(file.relPath, outputExt));
    return { file, sourceExt, outputKey, logicalKey: outputKey, canonicalSource };
  });

  const canonicalHashedKeys = new Set(
    plans.filter((plan) => plan.canonicalSource).map((plan) => plan.logicalKey),
  );

  const activePlans = plans.filter((plan) => {
    if (!plan.canonicalSource && canonicalHashedKeys.has(plan.logicalKey)) {
      superseded += 1;
      if (opts.verbose) console.log(`  ignore ${plan.file.relPath} (hashed source exists)`);
      return false;
    }
    return true;
  });

  console.log(`▶ checking ${activePlans.length} image(s) with Sharp cache...`);
  let completed = 0;

  await Promise.all(
    activePlans.map((plan) =>
      limit(async () => {
        const sourceStat = await fs.stat(plan.file.absPath);
        const distPath = path.join(DIST_DIR, plan.outputKey);
        const cached = cache.entries[plan.outputKey];
        const cacheMatches =
          !opts.force &&
          cached?.sourceRelPath === plan.file.relPath &&
          cached.sourceSize === sourceStat.size &&
          cached.sourceMtimeMs === sourceStat.mtimeMs &&
          cached.signature === buildSignature &&
          (await exists(distPath));

        if (cacheMatches) {
          allAssets[plan.logicalKey] = cached.asset;
          totalBytes += cached.asset.bytes;
          skipped += 1;
        } else {
          let prepared;
          if (opts.adoptExisting && (await exists(distPath))) {
            prepared = await inspectImage(
              await fs.readFile(distPath),
              path.extname(plan.outputKey),
            );
            adopted += 1;
          } else {
            const input = await fs.readFile(plan.file.absPath);
            prepared = await optimizeImage(input, plan.sourceExt, optimizeOpts);
            await fs.mkdir(path.dirname(distPath), { recursive: true });
            await fs.writeFile(distPath, prepared.data);
            built += 1;
          }

          const asset: AssetEntry = {
            key: plan.outputKey,
            url: `${cdnBase}/${plan.outputKey}`,
            contentType: prepared.contentType,
            width: prepared.width,
            height: prepared.height,
            bytes: prepared.data.length,
            contentHashed: false,
          };
          allAssets[plan.logicalKey] = asset;
          totalBytes += asset.bytes;
          cache.entries[plan.outputKey] = {
            sourceRelPath: plan.file.relPath,
            sourceSize: sourceStat.size,
            sourceMtimeMs: sourceStat.mtimeMs,
            signature: buildSignature,
            asset,
          };
        }
        completed += 1;

        if (!opts.verbose && (completed === activePlans.length || completed % 100 === 0)) {
          console.log(
            `  checked ${completed}/${activePlans.length} ` +
              `(${built} processed, ${skipped} skipped, ${adopted} adopted)`,
          );
        }

        if (opts.verbose) {
          const asset = allAssets[plan.logicalKey]!;
          console.log(`  ${plan.file.relPath}`);
          console.log(`    → ${plan.outputKey}  (${fmtBytes(asset.bytes)})`);
          console.log(`    ↗ ${asset.url}`);
        }
      }),
    ),
  );

  // Save this before manifest generation so a transient manifest write failure
  // never forces every image through Sharp again.
  await writeBuildCache(cache);

  // Clean up old flat shard files if they exist
  await cleanupLegacyManifests();

  // Write folder-level assets.json manifests mirroring source directory structure
  const folderPaths = await writeFolderManifests(allAssets, cdnBase);

  console.log(
    `✓ build: ${built} image(s) Sharp-minified${watermarkBuffer ? " + watermarked" : ""}, ` +
      `${skipped} skipped, ${adopted} adopted, ` +
      `${superseded} superseded raw source file(s) ignored → dist/ (${fmtBytes(totalBytes)})\n` +
      `  folder manifests: ${folderPaths.length} assets.json file(s) generated`,
  );

  if (opts.verbose) {
    for (const fp of folderPaths) {
      console.log(`  ✓ manifests/${fp}/assets.json`);
    }
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

interface UploadOpts {
  dryRun: boolean;
  publishManifest: boolean;
  verbose: boolean;
}

async function runUpload(opts: UploadOpts): Promise<void> {
  const { client, bucket } = getR2();
  const folderTargets = await collectFolderUploadTargets();

  if (folderTargets.length === 0) {
    console.warn("⚠  No manifests found. Run `npm run build` first.");
    return;
  }

  const limit = pLimit(concurrency());
  let uploaded = 0;
  let skipped = 0;
  let missing = 0;

  // 1. Collect all asset entries from all folder manifests
  const entriesMap = new Map<string, AssetEntry>();

  for (const target of folderTargets) {
    try {
      const content = await fs.readFile(target.localPath, "utf8");
      const manifest = JSON.parse(content);
      for (const entry of Object.values(manifest.assets) as AssetEntry[]) {
        if (entry && entry.key) {
          entriesMap.set(entry.key, entry);
        }
      }
    } catch {
      // ignore
    }
  }

  const entries = Array.from(entriesMap.values());
  // Fetch the bucket inventory once. Checking every object separately is much
  // slower, and checking only content-hashed names caused normal asset names to
  // be overwritten on every run.
  const existingKeys = new Set(await listAllObjects());

  // Upload only objects that do not already exist in R2.
  await Promise.all(
    entries.map((entry) =>
      limit(async () => {
        const filePath = path.join(DIST_DIR, entry.key);
        let body: Buffer;
        try {
          body = await fs.readFile(filePath);
        } catch {
          missing += 1;
          console.warn(`  ⚠ missing dist file: ${entry.key} — run build`);
          return;
        }

        const contentHashed = isContentHashed(entry);

        if (existingKeys.has(entry.key)) {
          skipped += 1;
          if (opts.verbose) console.log(`  skip  ${entry.key}`);
          return;
        }

        if (opts.dryRun) {
          console.log(`  would upload  ${entry.key}`);
          return;
        }

        await uploadObject({
          client,
          bucket,
          key: entry.key,
          body,
          contentType: entry.contentType || contentTypeFor(entry.key),
          cacheControl: contentHashed ? CACHE_CONTROL : MUTABLE_ASSET_CACHE_CONTROL,
        });
        uploaded += 1;
        if (opts.verbose) console.log(`  up    ${entry.key}`);
      }),
    ),
  );

  // 2. Upload folder assets.json manifests if requested
  if (opts.publishManifest && !opts.dryRun) {
    for (const t of folderTargets) {
      let body: Buffer;
      try {
        body = await fs.readFile(t.localPath);
      } catch {
        console.warn(`  ⚠ missing manifest file: ${t.localPath}`);
        continue;
      }
      await uploadObject({
        client,
        bucket,
        key: t.r2Key,
        body,
        contentType: "application/json",
        cacheControl: t.cacheControl,
      });
      console.log(`  ↑ ${t.r2Key}`);
    }
  }

  const dry = opts.dryRun ? " (dry-run)" : "";
  console.log(
    `✓ upload${dry}: ${uploaded} uploaded, ${skipped} skipped` +
      (missing ? `, ${missing} missing` : "") +
      ".",
  );
}

// ---------------------------------------------------------------------------
// Prune
// ---------------------------------------------------------------------------

async function runPrune(opts: { yes: boolean; prefix?: string }): Promise<void> {
  const result = await prune(opts);
  if (result.orphans.length === 0) {
    console.log("✓ prune: no orphaned objects.");
    return;
  }
  console.log(`Found ${result.orphans.length} orphaned object(s):`);
  for (const key of result.orphans) console.log(`  ${key}`);
  if (result.deleted) {
    console.log(`✓ deleted ${result.orphans.length} object(s).`);
  } else {
    console.log("(dry-run) re-run with --yes to delete.");
  }
}

// ---------------------------------------------------------------------------
// CLI Command Registration
// ---------------------------------------------------------------------------

const program = new Command();
program.name("tupapers-assets").description("R2 asset CDN pipeline for TUpapers").version("1.0.0");

program
  .command("build")
  .description(
    "Sharp-minify source/ images + watermark → dist/ + update folder assets.json manifests",
  )
  .option("--quality <1-100>", "WebP quality for raster images", parseQuality, 82)
  .option("--max-width <px>", "maximum raster width (never upscales)", (v) => Number(v))
  .option("--watermark <path>", "custom watermark image path")
  .option("--no-watermark", "build without watermark")
  .option("--force", "reprocess every image, ignoring the local Sharp cache")
  .option("--adopt-existing", "cache current dist outputs without reprocessing them")
  .option(
    "--watermark-position <position>",
    "bottom-right, bottom-left, top-right, top-left, or center",
    "bottom-right",
  )
  .option("-v, --verbose", "list every processed file with CDN URL")
  .action(async (o) => {
    await runBuild({
      quality: o.quality,
      maxWidth: o.maxWidth,
      watermarkPath: o.watermark,
      noWatermark: o.watermark === false,
      watermarkPosition: parsePosition(o.watermarkPosition),
      force: !!o.force,
      adoptExisting: !!o.adoptExisting,
      verbose: !!o.verbose,
    });
  });

program
  .command("upload")
  .description("Upload only manifest assets that do not already exist in R2")
  .option("--dry-run", "show what would upload without uploading")
  .option("--publish-manifest", "also upload folder assets.json manifests to R2")
  .option("-v, --verbose", "list every object decision")
  .action(async (o) => {
    await runUpload({
      dryRun: !!o.dryRun,
      publishManifest: !!o.publishManifest,
      verbose: !!o.verbose,
    });
  });

program
  .command("sync")
  .description("build + upload in one shot")
  .option("--quality <1-100>", "WebP quality for raster images", parseQuality, 82)
  .option("--max-width <px>", "maximum raster width (never upscales)", (v) => Number(v))
  .option("--watermark <path>", "custom watermark image path")
  .option("--no-watermark", "build without watermark")
  .option("--force", "reprocess every image, ignoring the local Sharp cache")
  .option("--adopt-existing", "cache current dist outputs without reprocessing them")
  .option(
    "--watermark-position <position>",
    "bottom-right, bottom-left, top-right, top-left, or center",
    "bottom-right",
  )
  .option("--dry-run", "build, then show what would upload")
  .option("--publish-manifest", "also upload folder assets.json manifests to R2")
  .option("-v, --verbose", "verbose output")
  .action(async (o) => {
    await runBuild({
      quality: o.quality,
      maxWidth: o.maxWidth,
      watermarkPath: o.watermark,
      noWatermark: o.watermark === false,
      watermarkPosition: parsePosition(o.watermarkPosition),
      force: !!o.force,
      adoptExisting: !!o.adoptExisting,
      verbose: !!o.verbose,
    });
    await runUpload({
      dryRun: !!o.dryRun,
      publishManifest: !!o.publishManifest,
      verbose: !!o.verbose,
    });
  });

program
  .command("prune")
  .description("List (dry-run) or delete bucket objects not in any manifest")
  .option("--prefix <prefix>", "limit bucket scan to a key prefix (e.g. course/bca/)")
  .option("--yes", "actually delete (default is dry-run)")
  .action(async (o) => {
    await runPrune({ yes: !!o.yes, prefix: o.prefix });
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
