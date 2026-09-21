import path from "node:path";

/**
 * Normalize one path segment into a clean, permanent, human-readable slug.
 * Folders are NEVER hashed — only cleaned.
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

/**
 * Build a stable output key from the source path. The filename (including an
 * existing legacy hash, if present) and extension are retained.
 */
export function buildNormalKey(relSourcePath: string, outputExt: string): string {
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
  return `${prefix}${slug}${outputExt.toLowerCase()}`;
}

/**
 * Existing hashed files are canonical source files now. Strip only a legacy
 * eight-character hash for the manifest lookup key, while keeping the actual
 * output key untouched. Normal filenames are returned unchanged.
 */
export function logicalKeyForOutput(outputKey: string): string {
  return outputKey.replace(/\.([0-9a-f]{8})(?=\.[^./]+$)/i, "");
}
