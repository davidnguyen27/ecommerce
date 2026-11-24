import { z } from 'zod'

const Text = z.string().trim().max(500)
const HttpUrl = z.union([z.literal(''), z.url({ protocol: /^https?$/ })])

/**
 * Business legal info shown in every website footer. An empty string means not filled; the system never fills it in.
 */
export const LegalInfo = z.object({
  companyName: Text,
  /** Enterprise code from the business registration certificate. */
  businessRegistrationNumber: Text,
  businessRegistrationIssuedBy: Text,
  /** `YYYY-MM-DD`. */
  businessRegistrationIssuedOn: z.union([z.literal(''), z.iso.date()]),
  address: Text,
  phone: Text,
  email: z.union([z.literal(''), z.email()]),
  /** The "Đã thông báo Bộ Công Thương" logo image. */
  moitLogoUrl: HttpUrl,
  /** The website registration page on online.gov.vn the logo links to. */
  moitNoticeUrl: HttpUrl,
})
export type LegalInfo = z.infer<typeof LegalInfo>

export const EMPTY_LEGAL_INFO: LegalInfo = {
  companyName: '',
  businessRegistrationNumber: '',
  businessRegistrationIssuedBy: '',
  businessRegistrationIssuedOn: '',
  address: '',
  phone: '',
  email: '',
  moitLogoUrl: '',
  moitNoticeUrl: '',
}
