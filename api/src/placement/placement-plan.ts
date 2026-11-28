import type { CheckoutRequest, VoucherConflict } from '@ecommerce/shared'
import type { z } from 'zod'
import type { CartVariant } from '../modules/product/index.ts'
import type { PaymentPurpose, Prisma } from '../generated/prisma/client.ts'
import type { VoucherLine } from '../vouchers/apply.ts'

// Internal types of order placement (`place-order.ts`): the per-kind part. Used only inside `placement/`.

export type Tx = Prisma.TransactionClient

/** Order line before the discount is split. */
export type LineDraft = Omit<Prisma.OrderLineUncheckedCreateWithoutOrderInput, 'discount'>

/** What the pipeline needs once a plan has locked and validated. */
export type Claim = {
  lines: LineDraft[]
  /** Lines as the voucher sees them (brand and category from the snapshot). */
  voucherLines: VoucherLine[]
  subtotal: number
  /** Variants whose product policy versions are snapshotted. */
  variants: Iterable<CartVariant>
  /** Campaign deposit percent; absent for in-stock orders. */
  depositPercent?: number
  /** 409 `details` when the voucher no longer matches what the customer saw. */
  voucherConflictDetails: (voucher: VoucherConflict) => Record<string, unknown>
  /** Per-kind part that needs the final amounts. */
  settle: (amounts: { total: number; depositAmount: number | null }) => {
    /** Per-kind `order` columns. */
    orderColumns: Partial<Prisma.OrderUncheckedCreateInput>
    /** Extra policy versions, added to the product policies. */
    extraPolicyVersionIds: string[]
    eventData: Prisma.InputJsonObject
    payment: { purpose: PaymentPurpose; amount: number; description: (code: number) => string }
  }
}

/** The per-kind part of placement. Callers pick a kind by entry point, never by plan. */
export type Plan<Input> = {
  /** Verb used in error messages: "đặt mua", "đặt trước". */
  verb: string
  saleType: 'standard' | 'preorder'
  /** 429 message for the per-IP limit. */
  tooManyAttempts: string
  /** Extra body checks before any DB work (step 1). */
  checkInput?: (input: Input) => void
  /** Steps 4–5: read kind-specific policy, lock variant or allocation rows, validate, build lines. Throws 409. */
  claim: (tx: Tx, input: Input) => Promise<Claim>
}

/** Body fields shared by checkout and pre-order, after parsing. */
export type PlacementInput = Pick<
  z.output<typeof CheckoutRequest>,
  'address' | 'invoice' | 'note' | 'acceptPrivacyPolicy' | 'voucherCode' | 'discount'
>
