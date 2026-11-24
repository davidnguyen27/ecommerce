import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Logger } from 'pino'

/**
 * `public`: product images and brand logos, served via CDN.
 * `private`: supplier documents, opened only via expiring signed URLs.
 */
export type Bucket = 'public' | 'private'

export type PutObject = {
  bucket: Bucket
  key: string
  body: Buffer
  contentType: string
}

/** File storage. Production uses R2; tests use the in-memory one. */
export interface Storage {
  put(object: PutObject): Promise<void>
  /** Public CDN URL of a file in the `public` bucket. */
  publicUrl(key: string): string
  /** Expiring signed URL to a file in the `private` bucket; `public` needs none. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>
  delete(bucket: Bucket, key: string): Promise<void>
}

export class InMemoryStorage implements Storage {
  /** Theo `<bucket>/<key>`. */
  readonly objects = new Map<string, PutObject>()

  async put(object: PutObject) {
    this.objects.set(`${object.bucket}/${object.key}`, object)
  }

  publicUrl(key: string) {
    return `memory://public/${key}`
  }

  async signedUrl(key: string, expiresInSeconds: number) {
    return `memory://private/${key}?expires=${expiresInSeconds}`
  }

  async delete(bucket: Bucket, key: string) {
    this.objects.delete(`${bucket}/${key}`)
  }
}

export type R2Config = {
  /** The account's S3 endpoint, `https://<account_id>.r2.cloudflarestorage.com`. */
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  buckets: Record<Bucket, string>
  /** CDN base URL (custom domain) of the public bucket, e.g. `https://cdn.shop.vn`. */
  publicBaseUrl: string
}

/** Cloudflare R2 via its S3-compatible API. */
export class R2Storage implements Storage {
  private readonly client: S3Client

  constructor(private readonly config: R2Config) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Bucket in the path, not the host: R2 accepts both, local MinIO only this one.
      forcePathStyle: true,
    })
  }

  async put({ bucket, key, body, contentType }: PutObject) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.buckets[bucket],
        Key: key,
        Body: body,
        ContentType: contentType,
        // Public keys are never overwritten (new prefix per image), so the CDN can cache forever.
        ...(bucket === 'public' && { CacheControl: 'public, max-age=31536000, immutable' }),
      }),
    )
  }

  publicUrl(key: string) {
    return `${this.config.publicBaseUrl.replace(/\/$/, '')}/${key}`
  }

  signedUrl(key: string, expiresInSeconds: number) {
    const command = new GetObjectCommand({ Bucket: this.config.buckets.private, Key: key })
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds })
  }

  async delete(bucket: Bucket, key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.buckets[bucket], Key: key }))
  }
}

/**
 * Picks storage from `STORAGE_PROVIDER`: `r2` (needs `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
 * `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, `MEDIA_PUBLIC_URL`) or `memory` for local (lost on restart).
 */
export function storageFromEnv(env: NodeJS.ProcessEnv, logger: Logger): Storage {
  switch (env.STORAGE_PROVIDER) {
    case 'r2': {
      const required = [
        'R2_ENDPOINT',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_PUBLIC_BUCKET',
        'R2_PRIVATE_BUCKET',
        'MEDIA_PUBLIC_URL',
      ] as const
      const missing = required.filter((name) => !env[name])
      if (missing.length > 0) throw new Error(`STORAGE_PROVIDER=r2 cần ${missing.join(', ')}`)
      return new R2Storage({
        endpoint: env.R2_ENDPOINT!,
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
        buckets: { public: env.R2_PUBLIC_BUCKET!, private: env.R2_PRIVATE_BUCKET! },
        publicBaseUrl: env.MEDIA_PUBLIC_URL!,
      })
    }
    case 'memory':
      logger.warn('Storage trong bộ nhớ: file tải lên mất khi khởi động lại, URL ảnh không mở được trên trình duyệt')
      return new InMemoryStorage()
    default:
      throw new Error('Thiếu STORAGE_PROVIDER hợp lệ (r2 hoặc memory)')
  }
}
