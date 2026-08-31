/**
 * Eleventy global data loader — TUpapers folder-structured asset CDN.
 *
 * Reads from `manifests/<folderPath>/assets.json` matching the source structure.
 * Manifests are loaded lazily per directory and cached in memory.
 *
 * Copy to: _src/_data/cdn.js in your Eleventy site.
 * Ensure: manifests/ folder (committed) lives at the project root,
 *         OR set CDN_MANIFEST_DIR env var to its absolute path.
 *
 * Usage in templates (Nunjucks):
 *   {% cdnImg "course/bca/fifth-semester/computer-networking/notes/chapter-1/dda-vsbresenham-line.webp",
 *             "DDA vs Bresenham Line", "rounded" %}
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Paths & Cache
// ---------------------------------------------------------------------------

const MANIFEST_DIR = process.env.CDN_MANIFEST_DIR
  ? path.resolve(process.env.CDN_MANIFEST_DIR)
  : path.resolve("./manifests");

const CDN_BASE = (process.env.CDN_BASE || "https://cdn.tupapers.com").replace(/\/+$/, "");

const folderCache = new Map();

/**
 * Load a folder asset manifest (e.g., manifests/course/bca/.../assets.json).
 */
function loadFolderManifest(dirPath) {
  if (folderCache.has(dirPath)) return folderCache.get(dirPath);

  const filePath = path.join(MANIFEST_DIR, dirPath, "assets.json");
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const assets = data.assets ?? {};
    folderCache.set(dirPath, assets);
    return assets;
  } catch {
    console.warn(`[cdn] could not load folder manifest: ${filePath}`);
    folderCache.set(dirPath, {});
    return {};
  }
}

function getDirPath(logicalKey) {
  const lastSlash = logicalKey.lastIndexOf("/");
  if (lastSlash === -1) return "";
  return logicalKey.substring(0, lastSlash);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Resolve a logical key to a full hashed CDN URL.
 *
 * @param {string} logicalKey  e.g. "course/bca/fifth-semester/computer-networking/notes/chapter-1/dda-vsbresenham-line.webp"
 * @returns {string}           e.g. "https://cdn.tupapers.com/course/bca/fifth-semester/.../dda-vsbresenham-line.bba9d466.webp"
 */
function resolve(logicalKey) {
  const dirPath = getDirPath(logicalKey);
  const assets = loadFolderManifest(dirPath);
  const fileName = path.basename(logicalKey);
  const entry = assets[fileName] ?? assets[logicalKey];
  if (!entry) {
    throw new Error(`[cdn] asset not in folder manifest (${dirPath}): ${logicalKey}`);
  }
  return entry.url;
}

/**
 * Get metadata for an asset: { key, url, width, height, bytes, contentType }.
 * Returns empty object if not found.
 */
function meta(logicalKey) {
  const dirPath = getDirPath(logicalKey);
  const assets = loadFolderManifest(dirPath);
  const fileName = path.basename(logicalKey);
  return assets[fileName] ?? assets[logicalKey] ?? {};
}

/**
 * List all assets in a folder.
 * @param {string} dirPath  e.g. "course/bca/fifth-semester/computer-networking/notes/chapter-1"
 * @returns {Record<string, object>}
 */
function listFolder(dirPath) {
  return loadFolderManifest(dirPath);
}

export default {
  base: CDN_BASE,
  resolve,
  meta,
  listFolder,
};
