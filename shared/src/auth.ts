import { z } from 'zod'

/** Header `X-Client` chọn kênh gửi refresh token: cookie cho web, body cho mobile. */
export const AuthClient = z.enum(['web', 'mobile'])
export type AuthClient = z.infer<typeof AuthClient>

export const LoginRequest = z.object({
  email: z.email(),
  password: z.string().min(1),
})
export type LoginRequest = z.infer<typeof LoginRequest>

/** Chỉ kênh mobile gửi body này; kênh web gửi refresh token qua cookie. */
export const RefreshRequest = z.object({
  refreshToken: z.string().min(1),
})
export type RefreshRequest = z.infer<typeof RefreshRequest>

/** `refreshToken` chỉ có ở kênh mobile. */
export const AuthTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
})
export type AuthTokens = z.infer<typeof AuthTokens>
