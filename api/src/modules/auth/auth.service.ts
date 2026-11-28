import { ErrorCode } from '@ecommerce/shared'
import { signAccessToken } from '../../core/auth/access-token.ts'
import { normalizeEmail } from '../../core/auth/email.ts'
import { hashPassword, verifyPassword } from '../../core/auth/password.ts'
import type { Db } from '../../core/db.ts'
import { AppError } from '../../core/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../../core/middleware/rate-limit.ts'
import type { AuthAudience } from '../../generated/prisma/client.ts'
import type { SessionAccounts } from './auth.interface.ts'
import {
  issueRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  type IssuedRefreshToken,
} from './refresh-token.ts'

// Unknown emails still run one verify, so response time does not reveal which emails exist.
// Hashed at module load, so even the first request costs exactly one verify.
const dummyHash = hashPassword('khong-co-tai-khoan')

/** Sessions of one auth domain (staff or customer): sign-in, refresh with rotation, sign-out. No HTTP here. */
export class SessionService {
  constructor(
    private readonly prisma: Db,
    private readonly secret: Uint8Array,
    readonly audience: AuthAudience,
    /** Absolute session lifetime from sign-in; refresh does not extend it. */
    private readonly sessionTtlMs: number,
    private readonly accounts: SessionAccounts,
  ) {}

  accessToken(subjectId: string) {
    return signAccessToken(this.secret, this.audience, subjectId)
  }

  /** Opens a new session for `subjectId`, e.g. right after sign-up. */
  open(subjectId: string): Promise<IssuedRefreshToken> {
    return issueRefreshToken(this.prisma, this.audience, subjectId, this.sessionTtlMs)
  }

  async login(email: string, password: string, clientIp: string): Promise<IssuedRefreshToken> {
    const { prisma, audience } = this
    // Count successful sign-ins too, and count before verifying so password guessers cannot burn our CPU.
    await enforceRateLimits(prisma, [
      { limit: RATE_LIMITS.loginPerEmail, subject: `${audience}:${normalizeEmail(email)}` },
      { limit: RATE_LIMITS.loginPerIp, subject: `${audience}:${clientIp}` },
    ])
    const account = await this.accounts.findCredentials(email)
    if (!account) await verifyPassword(await dummyHash, password)
    if (!account || !(await verifyPassword(account.passwordHash, password))) {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Email hoặc mật khẩu không đúng')
    }
    return this.open(account.id)
  }

  /** Rotates the refresh token; an account locked mid-rotation loses every session. */
  async refresh(token: string | undefined): Promise<IssuedRefreshToken> {
    const issued = token && (await rotateRefreshToken(this.prisma, this.audience, token))
    const expired = new AppError(401, ErrorCode.UNAUTHORIZED, 'Phiên đăng nhập đã hết hạn')
    if (!issued) throw expired
    if (!(await this.accounts.isActive(issued.subjectId))) {
      await revokeAllRefreshTokens(this.prisma, this.audience, issued.subjectId)
      throw expired
    }
    return issued
  }

  async logout(token: string | undefined) {
    if (token) await revokeRefreshToken(this.prisma, this.audience, token)
  }
}
