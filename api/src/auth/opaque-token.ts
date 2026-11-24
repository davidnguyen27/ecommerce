import { createHash, randomBytes } from 'node:crypto'

/** Random 256-bit token, safe in URLs. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

// A random 256-bit token makes SHA-256 enough; no slow password hash needed.
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
