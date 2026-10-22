import { z } from 'zod'

const Text = z.string().trim().max(500)
const HttpUrl = z.union([z.literal(''), z.url({ protocol: /^https?$/ })])

/**
 * Thông tin pháp lý của doanh nghiệp hiển thị ở chân trang mọi trang website.
 * Chuỗi rỗng nghĩa là chưa điền; hệ thống không tự điền nội dung.
 */
export const LegalInfo = z.object({
  companyName: Text,
  /** Mã số doanh nghiệp trên giấy chứng nhận đăng ký kinh doanh. */
  businessRegistrationNumber: Text,
  businessRegistrationIssuedBy: Text,
  /** `YYYY-MM-DD`. */
  businessRegistrationIssuedOn: z.union([z.literal(''), z.iso.date()]),
  address: Text,
  phone: Text,
  email: z.union([z.literal(''), z.email()]),
  /** Ảnh logo "Đã thông báo Bộ Công Thương". */
  moitLogoUrl: HttpUrl,
  /** Trang hồ sơ thông báo website trên online.gov.vn mà logo liên kết tới. */
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
