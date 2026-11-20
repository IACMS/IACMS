import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import config from '../../../config/index.js';

/**
 * S3 storage adapter (AWS S3 or S3-compatible endpoints).
 */
export class S3Storage {
  constructor() {
    const s3cfg = config.storage.s3;
    this.bucket = s3cfg.bucket;
    this.client = new S3Client({
      region: s3cfg.region,
      credentials: {
        accessKeyId: s3cfg.accessKeyId,
        secretAccessKey: s3cfg.secretAccessKey,
      },
      ...(s3cfg.endpoint ? { endpoint: s3cfg.endpoint } : {}),
      forcePathStyle: s3cfg.forcePathStyle,
    });
  }

  async upload(objectPath, stream, mimeType, size) {
    const body = stream instanceof Readable || stream?.pipe
      ? await streamToBuffer(stream)
      : stream;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectPath,
        Body: body,
        ContentType: mimeType,
        ...(size !== undefined ? { ContentLength: size } : {}),
      })
    );
  }

  async download(objectPath) {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectPath })
    );
    return res.Body;
  }

  async stream(objectPath, range) {
    const params = { Bucket: this.bucket, Key: objectPath };
    if (range) {
      params.Range = `bytes=${range.start}-${range.end}`;
    }
    const res = await this.client.send(new GetObjectCommand(params));
    return res.Body;
  }

  async delete(objectPath) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectPath })
    );
  }

  async exists(objectPath) {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectPath })
      );
      return true;
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async copy(sourcePath, destPath) {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourcePath}`,
        Key: destPath,
      })
    );
  }

  async stat(objectPath) {
    return await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: objectPath })
    );
  }

  async signedUrl(objectPath, expiresInSeconds = 600) {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: objectPath });
    return await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
