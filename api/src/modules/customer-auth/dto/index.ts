// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export {
  ForgotPasswordRequest as ForgotPasswordDto,
  RegisterRequest as RegisterDto,
  ResetPasswordRequest as ResetPasswordDto,
  VerifyEmailRequest as VerifyEmailDto,
} from '@ecommerce/shared'
