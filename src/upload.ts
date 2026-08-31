import { HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { CACHE_CONTROL } from "./config.js";

/** True if the object already exists in the bucket (content-addressed → skip). */
export async function objectExists(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey") {
      return false;
    }
    throw err;
  }
}

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
