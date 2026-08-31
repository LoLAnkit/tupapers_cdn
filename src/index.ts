#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import pLimit from "p-limit";
import {
  DIST_DIR,
  SOURCE_DIR,
  DEFAULT_WATERMARK_PATH,
  cdnBaseOnly,
  concurrency,
  getR2,
} from "./config.js";
import { discover } from "./discover.js";
import { optimizeImage, type OptimizeOptions, type WatermarkPosition } from "./optimize.js";
import { hashBytes } from "./hash.js";
import { buildKeys } from "./keys.js";
import {
  writeFolderManifests,
  cleanupLegacyManifests,
  collectFolderUploadTargets,
  type AssetEntry,
} from "./manifest.js";
import { objectExists, uploadObject } from "./upload.js";
import { prune } from "./prune.js";

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
};

function contentTypeFor(key: string): string {
  return CONTENT_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function parseMode(value: string): "graphic" | "photo" {
  if (value !== "graphic" && value !== "photo") {
    throw new Error(`--mode must be "graphic" or "photo" (got "${value}")`);
  }
  return value;
}

function parsePosition(value: string): WatermarkPosition {
  const valid: WatermarkPosition[] = [
    "bottom-right",
    "bottom-left",
    "top-right",
    "top-left",
    "center",
  ];
  if (!valid.includes(value as WatermarkPosition)) {
    throw new Error(
      `--watermark-position must be one of: ${valid.join(", ")} (got "${value}")`,
    );
  }
  return value as WatermarkPosition;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

interface BuildOpts {
  mode: "graphic" | "photo";
  maxWidth?: number;
  watermarkPath?: string;
  noWatermark?: boolean;
  watermarkPosition?: WatermarkPosition;
  verbose: boolean;
}

async function runBuild(opts: BuildOpts): Promise<void> {
  const cdnBase = cdnBaseOnly();
  const files = await discover(SOURCE_DIR);

  if (files.length === 0) {
    console.warn(`⚠  No source images found under ${path.relative(process.cwd(), SOURCE_DIR)}/`);
    return;
  }

  // Load watermark image if available
  let watermarkBuffer: Buffer | undefined;
  let watermarkSource: string | null = null;

  if (!opts.noWatermark) {
    const wmPath = opts.watermarkPath || DEFAULT_WATERMARK_PATH;
    try {
      watermarkBuffer = await fs.readFile(wmPath);
      watermarkSource = path.basename(wmPath);
    } catch {
      if (opts.watermarkPath) {
        console.warn(`⚠ Specified watermark file not found at: ${opts.watermarkPath}`);
      }
    }
  }

  const limit = pLimit(concurrency());
  const optimizeOpts: OptimizeOptions = {
    mode: opts.mode,
    maxWidth: opts.maxWidth,
    watermarkBuffer,
    watermarkPosition: opts.watermarkPosition ?? "bottom-right",
  };

  let built = 0;
  let totalBytes = 0;
  const allAssets: Record<string, AssetEntry> = {};

  await Promise.all(
    files.map((file) =>
      limit(async () => {
        const input = await fs.readFile(file.absPath);
        const optimized = await optimizeImage(input, path.extname(file.absPath), optimizeOpts);
        const hash = hashBytes(optimized.data);
        const { logicalKey, hashedKey } = buildKeys(file.relPath, optimized.ext, hash);
        const url = `${cdnBase}/${hashedKey}`;
        const distPath = path.join(DIST_DIR, hashedKey);

        await fs.mkdir(path.dirname(distPath), { recursive: true });
        await fs.writeFile(distPath, optimized.data);

        allAssets[logicalKey] = {
          key: hashedKey,
          url,
          contentType: optimized.contentType,
          width: optimized.width,
          height: optimized.height,
          bytes: optimized.data.length,
        };

        built += 1;
        totalBytes += optimized.data.length;

        if (opts.verbose) {
          console.log(`  ${file.relPath}`);
          console.log(`    → ${hashedKey}  (${fmtBytes(optimized.data.length)})`);
          console.log(`    ↗ ${url}`);
        }
      }),
    ),
  );

  // Clean up old flat shard files if they exist
  await cleanupLegacyManifests();

  // Write folder-level assets.json manifests mirroring source directory structure
  const folderPaths = await writeFolderManifests(allAssets, cdnBase);

  const wmStatus = watermarkBuffer
    ? `watermarked with "${watermarkSource}" (${opts.watermarkPosition ?? "bottom-right"})`
    : "no watermark";

  console.log(
    `✓ build: ${built} image(s) → dist/ (${fmtBytes(totalBytes)}) [${wmStatus}]\n` +
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
  const entriesMap = new Map<string, { key: string; contentType: string }>();

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

  // Upload image objects to dist
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

        if (await objectExists(client, bucket, entry.key)) {
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
program
  .name("tupapers-assets")
  .description("R2 asset CDN pipeline for TUpapers")
  .version("1.0.0");

program
  .command("build")
  .description("Optimize source/ images → dist/ + update folder assets.json manifests (no upload)")
  .option("--mode <mode>", "graphic (near-lossless) or photo (lossy q78)", "graphic")
  .option("--max-width <px>", "clamp max width in px (never upscales)", (v) => parseInt(v, 10))
  .option("--watermark <path>", "custom watermark image path")
  .option("--no-watermark", "disable watermarking")
  .option(
    "--watermark-position <pos>",
    "position: bottom-right, bottom-left, top-right, top-left, center",
    "bottom-right",
  )
  .option("-v, --verbose", "list every processed file with CDN URL")
  .action(async (o) => {
    await runBuild({
      mode: parseMode(o.mode),
      maxWidth: o.maxWidth,
      watermarkPath: o.watermark,
      noWatermark: o.watermark === false,
      watermarkPosition: parsePosition(o.watermarkPosition),
      verbose: !!o.verbose,
    });
  });

program
  .command("upload")
  .description("Upload dist/ objects to R2 (skips objects that already exist)")
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
  .option("--mode <mode>", "graphic or photo", "graphic")
  .option("--max-width <px>", "clamp max width in px", (v) => parseInt(v, 10))
  .option("--watermark <path>", "custom watermark image path")
  .option("--no-watermark", "disable watermarking")
  .option(
    "--watermark-position <pos>",
    "position: bottom-right, bottom-left, top-right, top-left, center",
    "bottom-right",
  )
  .option("--dry-run", "build, then show what would upload")
  .option("--publish-manifest", "also upload folder assets.json manifests to R2")
  .option("-v, --verbose", "verbose output")
  .action(async (o) => {
    await runBuild({
      mode: parseMode(o.mode),
      maxWidth: o.maxWidth,
      watermarkPath: o.watermark,
      noWatermark: o.watermark === false,
      watermarkPosition: parsePosition(o.watermarkPosition),
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
