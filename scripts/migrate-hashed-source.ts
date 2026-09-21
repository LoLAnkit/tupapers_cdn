#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { DIST_DIR, SOURCE_DIR } from "../src/config.js";
import { discover } from "../src/discover.js";
import { buildNormalKey, logicalKeyForOutput } from "../src/keys.js";
import { collectFolderUploadTargets, type FolderManifest } from "../src/manifest.js";

interface MigrationItem {
  logicalKey: string;
  distPath: string;
  targetPath: string;
  originalPath?: string;
  bytes: number;
}

function isHashedKey(key: string): boolean {
  return logicalKeyForOutput(key) !== key;
}

async function sameBytes(left: string, right: string): Promise<boolean> {
  const [leftStat, rightStat] = await Promise.all([fs.stat(left), fs.stat(right)]);
  if (leftStat.size !== rightStat.size) return false;
  const [leftData, rightData] = await Promise.all([fs.readFile(left), fs.readFile(right)]);
  return leftData.equals(rightData);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectMigration(): Promise<{
  items: MigrationItem[];
  alreadyCopied: number;
  conflicts: string[];
}> {
  const sourceFiles = await discover(SOURCE_DIR);
  const sourceByLegacyLogical = new Map<string, string[]>();

  for (const file of sourceFiles) {
    const sourceExt = path.extname(file.absPath).toLowerCase();
    const outputKey = buildNormalKey(file.relPath, sourceExt);
    if (isHashedKey(outputKey)) continue;

    const legacyExt = sourceExt === ".svg" ? ".svg" : ".webp";
    const legacyLogical = buildNormalKey(file.relPath, legacyExt);
    const candidates = sourceByLegacyLogical.get(legacyLogical) ?? [];
    candidates.push(file.absPath);
    sourceByLegacyLogical.set(legacyLogical, candidates);
  }

  const items: MigrationItem[] = [];
  const conflicts: string[] = [];
  let alreadyCopied = 0;

  for (const target of await collectFolderUploadTargets()) {
    const manifest = JSON.parse(await fs.readFile(target.localPath, "utf8")) as FolderManifest;
    for (const [filename, entry] of Object.entries(manifest.assets)) {
      if (!entry.key || !isHashedKey(entry.key)) continue;

      const logicalKey = `${manifest.path}/${filename}`;
      const distPath = path.join(DIST_DIR, ...entry.key.split("/"));
      const targetPath = path.join(SOURCE_DIR, ...entry.key.split("/"));
      const candidates = sourceByLegacyLogical.get(logicalKey) ?? [];

      if (!(await fileExists(distPath))) {
        conflicts.push(`${logicalKey}: missing dist file ${entry.key}`);
        continue;
      }
      if (candidates.length > 1) {
        conflicts.push(`${logicalKey}: multiple original source files (${candidates.join(", ")})`);
        continue;
      }
      if (await fileExists(targetPath)) {
        if (!(await sameBytes(distPath, targetPath))) {
          conflicts.push(`${logicalKey}: source target exists with different bytes (${entry.key})`);
          continue;
        }
        alreadyCopied += 1;
        items.push({
          logicalKey,
          distPath,
          targetPath,
          originalPath: candidates[0],
          bytes: entry.bytes,
        });
        continue;
      }

      items.push({
        logicalKey,
        distPath,
        targetPath,
        originalPath: candidates[0],
        bytes: entry.bytes,
      });
    }
  }

  return { items, alreadyCopied, conflicts };
}

async function copyVerified(item: MigrationItem): Promise<void> {
  await fs.mkdir(path.dirname(item.targetPath), { recursive: true });
  const tempPath = `${item.targetPath}.${process.pid}.${crypto.randomUUID()}.migration-tmp`;
  try {
    await fs.copyFile(item.distPath, tempPath);
    if (!(await sameBytes(item.distPath, tempPath))) {
      throw new Error(`verification failed for ${item.logicalKey}`);
    }
    await fs.rename(tempPath, item.targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function run(opts: { apply: boolean; removeOriginals: boolean }): Promise<void> {
  if (opts.removeOriginals && !opts.apply) {
    throw new Error("--remove-originals requires --apply");
  }

  const { items, alreadyCopied, conflicts } = await collectMigration();
  if (conflicts.length > 0) {
    throw new Error(
      `Migration stopped; ${conflicts.length} conflict(s):\n  ${conflicts.join("\n  ")}`,
    );
  }

  const pending = [] as MigrationItem[];
  for (const item of items) {
    if (!(await fileExists(item.targetPath))) pending.push(item);
  }

  const totalBytes = pending.reduce((sum, item) => sum + item.bytes, 0);
  if (!opts.apply) {
    let removableBytes = 0;
    for (const item of items) {
      if (item.originalPath && item.originalPath !== item.targetPath) {
        removableBytes += (await fs.stat(item.originalPath)).size;
      }
    }
    console.log(
      `Migration preview: ${pending.length} hashed dist file(s) to copy (${totalBytes} bytes), ` +
        `${alreadyCopied} already copied, ${items.filter((item) => item.originalPath).length} mapped original(s) ` +
        `occupying ${removableBytes} bytes.`,
    );
    return;
  }

  let copied = 0;
  let removed = 0;
  for (const item of items) {
    if (!(await fileExists(item.targetPath))) {
      await copyVerified(item);
      copied += 1;
    }
    if (opts.removeOriginals && item.originalPath && item.originalPath !== item.targetPath) {
      await fs.rm(item.originalPath);
      removed += 1;
    }
  }

  console.log(
    `✓ hashed source migration: ${copied} copied and byte-verified, ` +
      `${alreadyCopied} already present, ${removed} superseded original(s) removed.`,
  );
}

const program = new Command();
program
  .name("migrate-hashed-source")
  .description("Copy current hashed dist assets into source as canonical files")
  .option("--apply", "perform the copy (default is preview only)")
  .option(
    "--remove-originals",
    "after verification, remove source files superseded by canonical hashed files",
  )
  .action(async (options) => {
    await run({ apply: !!options.apply, removeOriginals: !!options.removeOriginals });
  });

program.parseAsync(process.argv).catch((error: Error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
