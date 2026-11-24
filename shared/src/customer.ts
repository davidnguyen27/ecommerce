import { z } from 'zod'

export const CUSTOMER_PASSWORD_MIN_LENGTH = 8

export const RegisterRequest = z.object({
  email: z.email(),
  password: z.string().min(CUSTOMER_PASSWORD_MIN_LENGTH).max(200),
  /** The "Tôi đồng ý với chính sách bảo mật" box; sign-up is impossible without it. */
  acceptPrivacyPolicy: z.literal(true, { error: 'Cần đồng ý với chính sách bảo mật để đăng ký' }),
})
export type RegisterRequest = z.infer<typeof RegisterRequest>

/** Token from the verification email link. */
export const VerifyEmailRequest = z.object({ token: z.string().min(1) })
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequest>

/** The signed-in customer. */
export const CustomerProfile = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  /** Consent at sign-up: privacy policy version and time of consent. */
  privacyConsent: z.object({ policyVersion: z.number().int(), consentedAt: z.string() }),
})
export type CustomerProfile = z.infer<typeof CustomerProfile>

/** Requests a password reset link; the response is the same whether or not the email has an account. */
export const ForgotPasswordRequest = z.object({ email: z.email() })
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>

/** Token from the password reset email link, with the new password. */
export const ResetPasswordRequest = z.object({
  token: z.string().min(1),
  password: z.string().min(CUSTOMER_PASSWORD_MIN_LENGTH).max(200),
})
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>

/** A signed-in customer changes their password on the account page. */
export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(CUSTOMER_PASSWORD_MIN_LENGTH).max(200),
})
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>
