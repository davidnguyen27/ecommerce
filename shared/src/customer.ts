import { z } from 'zod'

export const CUSTOMER_PASSWORD_MIN_LENGTH = 8

export const RegisterRequest = z.object({
  email: z.email(),
  password: z.string().min(CUSTOMER_PASSWORD_MIN_LENGTH).max(200),
  /** Ô "Tôi đồng ý với chính sách bảo mật"; không tick thì không đăng ký được. */
  acceptPrivacyPolicy: z.literal(true, { error: 'Cần đồng ý với chính sách bảo mật để đăng ký' }),
})
export type RegisterRequest = z.infer<typeof RegisterRequest>

/** Token lấy từ link trong email xác minh. */
export const VerifyEmailRequest = z.object({ token: z.string().min(1) })
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequest>

/** Khách đang đăng nhập. */
export const CustomerProfile = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  /** Lời đồng ý lúc đăng ký: phiên bản chính sách bảo mật và thời điểm đồng ý. */
  privacyConsent: z.object({ policyVersion: z.number().int(), consentedAt: z.string() }),
})
export type CustomerProfile = z.infer<typeof CustomerProfile>

/** Yêu cầu link đặt lại mật khẩu; phản hồi luôn như nhau dù email có tài khoản hay không. */
export const ForgotPasswordRequest = z.object({ email: z.email() })
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>

/** Token lấy từ link trong email đặt lại mật khẩu, kèm mật khẩu mới. */
export const ResetPasswordRequest = z.object({
  token: z.string().min(1),
  password: z.string().min(CUSTOMER_PASSWORD_MIN_LENGTH).max(200),
})
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>

/** Khách đang đăng nhập đổi mật khẩu trong trang tài khoản. */
export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(CUSTOMER_PASSWORD_MIN_LENGTH).max(200),
})
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>
