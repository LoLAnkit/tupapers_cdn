import fs from "node:fs/promises";
import path from "node:path";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getR2, SOURCE_DIR, DIST_DIR, MANIFEST_DIR, SHARP_BUILD_CACHE_PATH } from "../src/config.js";
import { listAllObjects } from "../src/prune.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeSubject(targetInput: string) {
  if (!targetInput) {
    console.error("Usage: npm run remove <path-to-subject>");
    console.error("Example: npm run remove course/bca/second-semester/ui-ux-design");
    process.exit(1);
  }

  // Normalize: remove leading 'source/', 'dist/', 'manifests/', and strip slashes
  let clean = targetInput
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(source|dist|manifests)\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  // Safety guard: ensure at least 4 segments: e.g. course/program/semester/subject
  const segments = clean.split("/");
  if (segments.length < 4 || segments[0] !== "course") {
    console.error(`\n❌ Error: Safety check failed for "${clean}".`);
    console.error("Target must specify a specific subject path, e.g.:");
    console.error("  course/bca/second-semester/ui-ux-design\n");
    process.exit(1);
  }

  const prefix = `${clean}/`;
  console.log(`\n========================================`);
  console.log(`Removing Subject: ${clean}`);
  console.log(`========================================\n`);

  // 1. Delete from Cloudflare R2
  console.log(`1. Scanning Cloudflare R2 under prefix: "${prefix}"...`);
  const r2Keys = await listAllObjects(prefix);
  if (r2Keys.length > 0) {
    console.log(`   Found ${r2Keys.length} object(s) in R2 to delete.`);
    const { client, bucket } = getR2();
    for (let i = 0; i < r2Keys.length; i += 1000) {
      const chunk = r2Keys.slice(i, i + 1000).map((Key) => ({ Key }));
      await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk, Quiet: true } }),
      );
    }
    console.log(`   ✓ Deleted ${r2Keys.length} object(s) from Cloudflare R2.`);
  } else {
    console.log(`   ✓ No objects found in Cloudflare R2.`);
  }

  // 2. Remove Local Directories (source, dist, manifests)
  const dirs = [
    { name: "source", path: path.join(SOURCE_DIR, clean) },
    { name: "dist", path: path.join(DIST_DIR, clean) },
    { name: "manifests", path: path.join(MANIFEST_DIR, clean) },
  ];

  console.log(`\n2. Removing local directories...`);
  for (const dir of dirs) {
    if (await exists(dir.path)) {
      await fs.rm(dir.path, { recursive: true, force: true });
      console.log(`   ✓ Deleted ${dir.name}/${clean}`);
    } else {
      console.log(`   - ${dir.name}/${clean} does not exist (skipped)`);
    }
  }

  // 3. Clean Sharp Build Cache
  console.log(`\n3. Cleaning .sharp-build-cache.json...`);
  if (await exists(SHARP_BUILD_CACHE_PATH)) {
    try {
      const raw = await fs.readFile(SHARP_BUILD_CACHE_PATH, "utf8");
      const cache = JSON.parse(raw);
      let removedCount = 0;
      if (cache.entries && typeof cache.entries === "object") {
        for (const [key, val] of Object.entries(cache.entries as Record<string, any>)) {
          if (key.includes(clean) || (val?.sourceRelPath && val.sourceRelPath.includes(clean))) {
            delete cache.entries[key];
            removedCount++;
          }
        }
        await fs.writeFile(
          SHARP_BUILD_CACHE_PATH,
          JSON.stringify(cache, null, 2) + "\n",
          "utf8",
        );
      }
      console.log(`   ✓ Removed ${removedCount} entry/entries from cache.`);
    } catch (err: any) {
      console.warn(`   ⚠ Could not update cache file: ${err.message}`);
    }
  } else {
    console.log(`   - Cache file not found (skipped)`);
  }

  console.log(`\n✅ Successfully removed "${clean}" from Cloud, Source, Dist, Manifests, and Cache!\n`);
}

const target = process.argv[2];
removeSubject(target).catch((err) => {
  console.error(`\n❌ Error:`, err.message);
  process.exit(1);
});
