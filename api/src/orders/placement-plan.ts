import type { CheckoutRequest, VoucherConflict } from '@ecommerce/shared'
import type { z } from 'zod'
import type { CartVariant } from '../checkout/live-variants.ts'
import type { PaymentPurpose, Prisma } from '../generated/prisma/client.ts'
import type { VoucherLine } from '../vouchers/apply.ts'

// Kiểu nội bộ của module đặt đơn (`place-order.ts`): phần riêng của mỗi loại đơn. Chỉ dùng trong `orders/`.

export type Tx = Prisma.TransactionClient

/** Dòng đơn trước khi chia tiền giảm. */
export type LineDraft = Omit<Prisma.OrderLineUncheckedCreateWithoutOrderInput, 'discount'>

/** Phần của một loại đơn mà pipeline cần sau khi plan đã khóa và kiểm. */
export type Claim = {
  lines: LineDraft[]
  /** Các dòng như mã giảm giá thấy (thương hiệu, danh mục lấy từ snapshot). */
  voucherLines: VoucherLine[]
  subtotal: number
  /** Biến thể để chụp phiên bản chính sách của sản phẩm. */
  variants: Iterable<CartVariant>
  /** Mức cọc của đợt; không có với đơn hàng sẵn. */
  depositPercent?: number
  /** `details` của 409 khi mã giảm giá không còn như khách đã thấy. */
  voucherConflictDetails: (voucher: VoucherConflict) => Record<string, unknown>
  /** Phần riêng của loại đơn, tính khi đã có số tiền. */
  settle: (amounts: { total: number; depositAmount: number | null }) => {
    /** Cột riêng của loại đơn trên `order`. */
    orderColumns: Partial<Prisma.OrderUncheckedCreateInput>
    /** Phiên bản chính sách riêng của loại đơn, thêm vào chính sách của sản phẩm. */
    extraPolicyVersionIds: string[]
    eventData: Prisma.InputJsonObject
    payment: { purpose: PaymentPurpose; amount: number; description: (code: number) => string }
  }
}

/** Phần riêng của một loại đơn. Nội bộ module: nơi gọi chọn loại đơn bằng entry point. */
export type Plan<Input> = {
  /** Động từ trong thông điệp lỗi: "đặt mua", "đặt trước". */
  verb: string
  saleType: 'standard' | 'preorder'
  /** Thông điệp 429 khi quá giới hạn đặt theo IP. */
  tooManyAttempts: string
  /** Kiểm thêm trước khi đụng DB (bước 1). */
  checkInput?: (input: Input) => void
  /** Bước 4–5: đọc chính sách riêng, khóa dòng biến thể hay dòng suất, kiểm và dựng dòng đơn. Lỗi thì ném 409. */
  claim: (tx: Tx, input: Input) => Promise<Claim>
}

/** Phần chung của body đặt mua và đặt trước, sau khi parse. */
export type PlacementInput = Pick<
  z.output<typeof CheckoutRequest>,
  'address' | 'invoice' | 'note' | 'acceptPrivacyPolicy' | 'voucherCode' | 'discount'
>
