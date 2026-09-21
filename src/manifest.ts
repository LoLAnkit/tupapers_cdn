import fs from "node:fs/promises";
import path from "node:path";
import { MANIFEST_DIR, DIST_DIR, ROOT, MANIFEST_CACHE_CONTROL } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssetEntry {
  /** Actual R2 key. */
  key: string;
  /** Pre-built full CDN URL — ready to drop into an <img src>. */
  url: string;
  contentType: string;
  width?: number;
  height?: number;
  bytes: number;
  /** True when the canonical source filename already contains a legacy content hash. */
  contentHashed?: boolean;
}

/** Hierarchical manifest covering a single folder (e.g., chapter-1 or diagram folder). */
export interface FolderManifest {
  version: number;
  generatedAt: string;
  cdnBase: string;
  /** Directory relative path, e.g. "course/bca/fifth-semester/computer-networking/notes/chapter-1" */
  path: string;
  totalAssets: number;
  /**
   * Short filename key → AssetEntry.
   * Format:
   *   "dda-vsbresenham-line.webp": { ... }
   */
  assets: Record<string, AssetEntry>;
  /** Array of all asset URLs for easy copy-paste. */
  urls: string[];
}

export interface ManifestUploadTarget {
  localPath: string;
  r2Key: string;
  cacheControl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Windows can briefly lock a generated JSON file; retry those transient writes. */
async function writeJsonWithRetry(filePath: string, data: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.writeFile(filePath, data, "utf8");
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Write folder-level `assets.json` manifests for all folders containing assets.
 * Outputs to both `manifests/<dirPath>/assets.json` and `dist/<dirPath>/assets.json`.
 */
export async function writeFolderManifests(
  allAssets: Record<string, AssetEntry>,
  cdnBase: string,
): Promise<string[]> {
  // Group assets by directory path
  const folderMap = new Map<string, Record<string, AssetEntry>>();

  for (const [logicalKey, entry] of Object.entries(allAssets)) {
    const lastSlash = logicalKey.lastIndexOf("/");
    if (lastSlash === -1) continue;

    const dirPath = logicalKey.substring(0, lastSlash);
    if (!folderMap.has(dirPath)) {
      folderMap.set(dirPath, {});
    }

    const folderAssets = folderMap.get(dirPath)!;
    const filename = logicalKey.substring(lastSlash + 1);
    folderAssets[filename] = entry;
  }

  const writtenFolders: string[] = [];

  for (const [dirPath, assets] of folderMap.entries()) {
    // Sort keys alphabetically
    const sortedAssets: Record<string, AssetEntry> = {};
    for (const key of Object.keys(assets).sort()) {
      sortedAssets[key] = assets[key]!;
    }

    // Collect all URLs in order
    const urls = Object.values(sortedAssets).map((asset) => asset.url);

    const folderManifest: FolderManifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      cdnBase,
      path: dirPath,
      totalAssets: Object.keys(sortedAssets).length,
      assets: sortedAssets,
      urls,
    };

    const jsonStr = `${JSON.stringify(folderManifest, null, 2)}\n`;

    // 1. Write to manifests/<dirPath>/assets.json
    const manifestPath = path.join(MANIFEST_DIR, dirPath, "assets.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await writeJsonWithRetry(manifestPath, jsonStr);

    // 2. Write to dist/<dirPath>/assets.json
    const distPath = path.join(DIST_DIR, dirPath, "assets.json");
    await fs.mkdir(path.dirname(distPath), { recursive: true });
    await writeJsonWithRetry(distPath, jsonStr);

    writtenFolders.push(dirPath);
  }

  return writtenFolders;
}

/**
 * Remove legacy flat dot-separated files (course.*.json, index.json, root manifest.json)
 * if they exist from previous versions.
 */
export async function cleanupLegacyManifests(): Promise<void> {
  const legacyFiles = [path.join(ROOT, "manifest.json"), path.join(MANIFEST_DIR, "index.json")];

  try {
    const files = await fs.readdir(MANIFEST_DIR);
    for (const file of files) {
      if (file.endsWith(".json") && file.includes(".")) {
        legacyFiles.push(path.join(MANIFEST_DIR, file));
      }
    }
  } catch {
    // directory may not exist
  }

  for (const file of legacyFiles) {
    try {
      await fs.unlink(file);
    } catch {
      // Ignore if file doesn't exist
    }
  }
}

/**
 * Collect all `assets.json` manifest files written under `manifests/` or `dist/`
 * for uploading to R2.
 */
export async function collectFolderUploadTargets(): Promise<ManifestUploadTarget[]> {
  const targets: ManifestUploadTarget[] = [];

  async function walk(dir: string, baseDir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, baseDir);
      } else if (entry.isFile() && entry.name === "assets.json") {
        const relPath = path.relative(baseDir, full).split(path.sep).join("/");
        targets.push({
          localPath: full,
          r2Key: relPath,
          cacheControl: MANIFEST_CACHE_CONTROL,
        });
      }
    }
  }

  await walk(MANIFEST_DIR, MANIFEST_DIR);
  return targets;
}

/** Read one folder manifest from disk. */
export async function readFolderManifest(dirPath: string): Promise<FolderManifest | null> {
  const filePath = path.join(MANIFEST_DIR, dirPath, "assets.json");
  return readJson<FolderManifest>(filePath);
}

/** Resolve a logical key by reading its folder `assets.json`. */
export async function resolve(logicalKey: string): Promise<string> {
  const lastSlash = logicalKey.lastIndexOf("/");
  if (lastSlash === -1) {
    throw new Error(`Invalid logical key: ${logicalKey}`);
  }

  const dirPath = logicalKey.substring(0, lastSlash);
  const filename = logicalKey.substring(lastSlash + 1);
  const manifest = await readFolderManifest(dirPath);

  if (!manifest) {
    throw new Error(`[manifest] asset not found in folder manifest "${dirPath}": ${logicalKey}`);
  }

  const entry = manifest.assets[filename] ?? manifest.assets[logicalKey];
  if (!entry) {
    throw new Error(`[manifest] asset not found in folder manifest "${dirPath}": ${logicalKey}`);
  }

  return entry.url;
}
