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
  publicUrl(key: string): string
  signedUrl(key: string, expiresInSeconds: number): Promise<string>
  delete(bucket: Bucket, key: string): Promise<void>
}

export class InMemoryStorage implements Storage {
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
