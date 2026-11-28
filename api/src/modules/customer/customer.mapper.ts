import type { CustomerProfile } from '@ecommerce/shared'
import type { Customer } from '../../generated/prisma/client.ts'

export function toCustomerProfile(
  customer: Customer,
  consent: { consentedAt: Date; policyVersion: { version: number } },
): CustomerProfile {
  return {
    id: customer.id,
    email: customer.email,
    emailVerified: customer.emailVerifiedAt !== null,
    privacyConsent: {
      policyVersion: consent.policyVersion.version,
      consentedAt: consent.consentedAt.toISOString(),
    },
  }
}
