#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import pLimit from "p-limit";
import tinify from "tinify";
import { ROOT, SOURCE_DIR, tinifyApiKey, tinifyConcurrency } from "./config.js";
import { discover } from "./discover.js";

const CACHE_PATH = path.join(ROOT, ".tinify-cache.json");
const TINIFY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);

interface CacheFile {
  version: 1;
  files: Record<string, string>;
}

interface MinifyOptions {
  all: boolean;
  force: boolean;
  dryRun: boolean;
  verbose: boolean;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function sha256(data: Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function relativeSourcePath(absPath: string): string {
  return path.relative(SOURCE_DIR, absPath).split(path.sep).join("/");
}

function isInsideSource(absPath: string): boolean {
  const relative = path.relative(SOURCE_DIR, absPath);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

async function readCache(): Promise<CacheFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(CACHE_PATH, "utf8")) as Partial<CacheFile>;
    if (parsed.version === 1 && parsed.files && typeof parsed.files === "object") {
      return { version: 1, files: parsed.files };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("⚠  Ignoring unreadable .tinify-cache.json; a new cache will be written.");
    }
  }
  return { version: 1, files: {} };
}

async function writeCache(cache: CacheFile): Promise<void> {
  const sortedFiles = Object.fromEntries(
    Object.entries(cache.files).sort(([a], [b]) => a.localeCompare(b)),
  );
  const tempPath = `${CACHE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(
    tempPath,
    `${JSON.stringify({ version: 1, files: sortedFiles }, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(tempPath, CACHE_PATH);
}

async function replaceFileAtomically(filePath: string, data: Buffer): Promise<void> {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tinify-tmp`,
  );

  try {
    const stat = await fs.stat(filePath);
    await fs.writeFile(tempPath, data, { mode: stat.mode });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function collectFiles(inputs: string[], all: boolean): Promise<string[]> {
  const candidates = new Set<string>();

  if (all) {
    for (const file of await discover(SOURCE_DIR)) {
      candidates.add(file.absPath);
    }
  }

  for (const input of inputs) {
    const absPath = path.resolve(ROOT, input);
    if (!isInsideSource(absPath)) {
      throw new Error(`Only files and folders inside source/ are allowed: ${input}`);
    }

    let stat;
    try {
      stat = await fs.stat(absPath);
    } catch {
      throw new Error(`Source path does not exist: ${input}`);
    }

    if (stat.isDirectory()) {
      for (const file of await discover(absPath)) {
        candidates.add(file.absPath);
      }
    } else if (stat.isFile()) {
      candidates.add(absPath);
    }
  }

  return [...candidates]
    .filter((filePath) => TINIFY_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort((a, b) => relativeSourcePath(a).localeCompare(relativeSourcePath(b)));
}

async function run(inputs: string[], opts: MinifyOptions): Promise<void> {
  if (!opts.all && inputs.length === 0) {
    throw new Error("Pass one or more new source image paths, or use --all explicitly.");
  }
  if (opts.all && inputs.length > 0) {
    throw new Error("Use either explicit paths or --all, not both.");
  }

  const files = await collectFiles(inputs, opts.all);
  if (files.length === 0) {
    console.warn("⚠  No TinyPNG-compatible images found (PNG, JPEG, WebP, or AVIF).");
    return;
  }

  const cache = await readCache();
  const pending: Array<{ absPath: string; relPath: string; input: Buffer; inputHash: string }> = [];
  let skipped = 0;

  for (const absPath of files) {
    const relPath = relativeSourcePath(absPath);
    const input = await fs.readFile(absPath);
    const inputHash = sha256(input);
    if (!opts.force && cache.files[relPath] === inputHash) {
      skipped += 1;
      if (opts.verbose) console.log(`  skip  ${relPath} (unchanged)`);
      continue;
    }
    pending.push({ absPath, relPath, input, inputHash });
  }

  if (opts.dryRun) {
    for (const item of pending) console.log(`  would minify  ${item.relPath}`);
    console.log(`✓ source minify (dry-run): ${pending.length} pending, ${skipped} unchanged.`);
    return;
  }

  if (pending.length === 0) {
    console.log(`✓ source minify: 0 compressed, ${skipped} unchanged.`);
    return;
  }

  tinify.key = tinifyApiKey();
  tinify.appIdentifier = "tupapers-assets/1.0";

  const limit = pLimit(tinifyConcurrency());
  let compressed = 0;
  let savedBytes = 0;
  const failures: string[] = [];

  await Promise.all(
    pending.map((item) =>
      limit(async () => {
        try {
          const result = Buffer.from(await tinify.fromBuffer(item.input).toBuffer());
          let finalData = item.input;

          if (result.length < item.input.length) {
            await replaceFileAtomically(item.absPath, result);
            finalData = result;
            savedBytes += item.input.length - result.length;
          }

          cache.files[item.relPath] = sha256(finalData);
          compressed += 1;
          if (opts.verbose) {
            console.log(
              `  min   ${item.relPath} (${fmtBytes(item.input.length)} → ${fmtBytes(finalData.length)})`,
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`${item.relPath}: ${message}`);
        }
      }),
    ),
  );

  await writeCache(cache);

  const count = tinify.compressionCount;
  console.log(
    `✓ source minify: ${compressed} compressed, ${skipped} unchanged, saved ${fmtBytes(savedBytes)}` +
      (typeof count === "number" ? ` (TinyPNG monthly count: ${count})` : "") +
      ".",
  );

  if (failures.length > 0) {
    throw new Error(`TinyPNG failed for ${failures.length} image(s):\n  ${failures.join("\n  ")}`);
  }
}

const program = new Command();
program
  .name("minify-source")
  .description("Compress newly generated source images in place with TinyPNG")
  .argument("[paths...]", "image files or folders inside source/")
  .option("--all", "process every compatible image under source/ (explicit opt-in)")
  .option("--force", "compress even when the local checksum cache says unchanged")
  .option("--dry-run", "show which images would be sent without using the API")
  .option("-v, --verbose", "list every image decision")
  .action(async (paths: string[], options) => {
    await run(paths, {
      all: !!options.all,
      force: !!options.force,
      dryRun: !!options.dryRun,
      verbose: !!options.verbose,
    });
  });

program.parseAsync(process.argv).catch((error: Error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
