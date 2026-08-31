import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".tiff",
  ".svg",
]);

export interface SourceFile {
  /** Absolute path on disk. */
  absPath: string;
  /** Path relative to the source dir, POSIX-separated. */
  relPath: string;
}

/** Recursively walk `sourceDir` and return every supported image, sorted. */
export async function discover(sourceDir: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // dir doesn't exist yet — treated as empty
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
        out.push({
          absPath: full,
          relPath: path.relative(sourceDir, full).split(path.sep).join("/"),
        });
      }
    }
  }

  await walk(sourceDir);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}
