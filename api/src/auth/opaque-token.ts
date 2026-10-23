import { createHash, randomBytes } from 'node:crypto'

/** Token ngẫu nhiên 256 bit, an toàn để đặt trong URL. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

// Token ngẫu nhiên 256 bit nên SHA-256 là đủ, không cần hàm băm chậm như mật khẩu.
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
