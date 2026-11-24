import { z } from 'zod'

/** The `X-Client` header picks how the refresh token travels: cookie for web, body for mobile. */
export const AuthClient = z.enum(['web', 'mobile'])
export type AuthClient = z.infer<typeof AuthClient>

export const LoginRequest = z.object({
  email: z.email(),
  password: z.string().min(1),
})
export type LoginRequest = z.infer<typeof LoginRequest>

/** Only the mobile channel sends this body; web sends the refresh token as a cookie. */
export const RefreshRequest = z.object({
  refreshToken: z.string().min(1),
})
export type RefreshRequest = z.infer<typeof RefreshRequest>

/** `refreshToken` is present only for the mobile channel. */
export const AuthTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
})
export type AuthTokens = z.infer<typeof AuthTokens>
