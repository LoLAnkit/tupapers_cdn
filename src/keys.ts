import path from "node:path";

/**
 * Normalize one path segment into a clean, permanent, human-readable slug.
 * Folders are NEVER hashed — only cleaned. The filename hash is added elsewhere.
 */
export function slugifySegment(segment: string): string {
  return segment
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w.\s-]/g, "") // drop anything that isn't word char / dot / space / hyphen
    .trim()
    .replace(/[\s_]+/g, "-") // spaces & underscores → hyphen
    .replace(/-+/g, "-") // collapse repeats
    .replace(/^-|-$/g, "");
}

export interface BuiltKeys {
  /** Stable, pre-hash key templates reference (e.g. .../addressing-modes.webp). */
  logicalKey: string;
  /** Actual uploaded key with content hash (e.g. .../addressing-modes.7e8d3c41.webp). */
  hashedKey: string;
}

/**
 * From a source path relative to `source/` (e.g.
 * `course/bca/first-semester/computer-fundamental/notes/diagram/addressing-modes.png`)
 * derive the logical and hashed R2 keys, using the OPTIMIZED extension.
 */
export function buildKeys(relSourcePath: string, optimizedExt: string, hash: string): BuiltKeys {
  const posix = relSourcePath.split(path.sep).join("/");
  const segments = posix.split("/").filter(Boolean);

  const filename = segments.pop();
  if (!filename) {
    throw new Error(`Cannot derive key from empty path: "${relSourcePath}"`);
  }

  const base = filename.replace(/\.[^.]+$/, "");
  const slug = slugifySegment(base);
  if (!slug) {
    throw new Error(`Filename slugified to empty string: "${filename}"`);
  }

  const dir = segments.map(slugifySegment).filter(Boolean).join("/");
  const prefix = dir ? `${dir}/` : "";

  return {
    logicalKey: `${prefix}${slug}${optimizedExt}`,
    hashedKey: `${prefix}${slug}.${hash}${optimizedExt}`,
  };
}
