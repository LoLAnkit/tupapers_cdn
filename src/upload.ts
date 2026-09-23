import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { CACHE_CONTROL } from "./config.js";

export interface UploadArgs {
  client: S3Client;
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
  /** Defaults to the immutable 1-year cache header. */
  cacheControl?: string;
}

export async function uploadObject(args: UploadArgs): Promise<void> {
  await args.client.send(
    new PutObjectCommand({
      Bucket: args.bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
      CacheControl: args.cacheControl ?? CACHE_CONTROL,
    }),
  );
}
