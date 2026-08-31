import fs from "node:fs/promises";
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getR2 } from "./config.js";
import { collectFolderUploadTargets, type FolderManifest } from "./manifest.js";

/** List every object key in the bucket (optionally under a prefix). */
export async function listAllObjects(prefix?: string): Promise<string[]> {
  const { client, bucket } = getR2();
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  return keys;
}

export interface PruneResult {
  orphans: string[];
  deleted: boolean;
}

/**
 * Find bucket objects not referenced by any current folder asset manifest.
 * Dry-run by default; pass `yes: true` to actually delete.
 */
export async function prune(opts: { yes: boolean; prefix?: string }): Promise<PruneResult> {
  const { client, bucket } = getR2();
  const folderTargets = await collectFolderUploadTargets();

  const referenced = new Set<string>();

  for (const target of folderTargets) {
    referenced.add(target.r2Key);
    try {
      const content = await fs.readFile(target.localPath, "utf8");
      const manifest = JSON.parse(content) as FolderManifest;
      for (const entry of Object.values(manifest.assets)) {
        if (entry.key) {
          referenced.add(entry.key);
        }
      }
    } catch {
      // Ignore unparseable
    }
  }

  const live = await listAllObjects(opts.prefix);
  const orphans = live.filter((key) => !referenced.has(key));

  if (opts.yes && orphans.length > 0) {
    for (let i = 0; i < orphans.length; i += 1000) {
      const chunk = orphans.slice(i, i + 1000).map((Key) => ({ Key }));
      await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk, Quiet: true } }),
      );
    }
  }

  return { orphans, deleted: opts.yes && orphans.length > 0 };
}
