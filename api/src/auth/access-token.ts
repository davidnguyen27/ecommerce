import { SignJWT, jwtVerify } from 'jose'
import type { AuthAudience } from '../generated/prisma/client.ts'

const ACCESS_TOKEN_TTL = '15m'

/** Payload chỉ có định danh và audience; quyền được đọc từ DB ở mỗi request. */
export function signAccessToken(secret: Uint8Array, audience: AuthAudience, subjectId: string) {
  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subjectId)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secret)
}

/** Trả về subject nếu token còn hạn và đúng audience, ngược lại `null`. */
export async function verifyAccessToken(secret: Uint8Array, audience: AuthAudience, token: string) {
  try {
    const { payload } = await jwtVerify(token, secret, { audience, algorithms: ['HS256'] })
    return payload.sub ?? null
  } catch {
    return null
  }
}
