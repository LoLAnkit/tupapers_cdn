import { createHash } from "node:crypto";

/**
 * Content hash of the FINAL optimized bytes.
 * First 8 hex chars of SHA-256 (~4.3B values — ample for a few thousand images).
 */
export function hashBytes(data: Buffer, length = 8): string {
  return createHash("sha256").update(data).digest("hex").slice(0, length);
}
