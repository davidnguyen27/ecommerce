import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Logger } from 'pino'

/**
 * `public`: ảnh sản phẩm, logo thương hiệu, phục vụ qua CDN.
 * `private`: chứng từ nguồn hàng, chỉ mở được qua URL ký có hạn.
 */
export type Bucket = 'public' | 'private'

export type PutObject = {
  bucket: Bucket
  key: string
  body: Buffer
  contentType: string
}

/** Lưu trữ file. Production dùng R2; test dùng bản trong bộ nhớ. */
export interface Storage {
  put(object: PutObject): Promise<void>
  /** URL công khai qua CDN của một file trong bucket `public`. */
  publicUrl(key: string): string
  /** URL ký có hạn tới một file trong bucket `private`; bucket `public` không cần URL ký. */
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
  /** Endpoint S3 của tài khoản, `https://<account_id>.r2.cloudflarestorage.com`. */
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  buckets: Record<Bucket, string>
  /** Gốc URL CDN (custom domain) gắn với bucket public, ví dụ `https://cdn.shop.vn`. */
  publicBaseUrl: string
}

/** Cloudflare R2 qua API tương thích S3. */
export class R2Storage implements Storage {
  private readonly client: S3Client

  constructor(private readonly config: R2Config) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Bucket nằm trong path, không trong tên miền: R2 nhận cả hai kiểu, MinIO ở local chỉ nhận kiểu này.
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
        // Key public không bao giờ bị ghi đè (mỗi ảnh một tiền tố mới), nên CDN giữ mãi được.
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
 * Chọn storage theo `STORAGE_PROVIDER`: `r2` (cần `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
 * `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, `MEDIA_PUBLIC_URL`) hoặc `memory` cho local (mất khi khởi động lại).
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
