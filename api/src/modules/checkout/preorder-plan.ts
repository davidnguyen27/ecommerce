import { ErrorCode, type PreorderChange, type PreorderConflictDetails, type PreorderRequest } from '@ecommerce/shared'
import type { z } from 'zod'
import { storedImageOf } from './order-snapshot.ts'
import { findCurrentPreorderPolicy } from '../../content/pages.ts'
import { AppError, invalidField } from '../../core/errors.ts'
import { checkPreorder } from '../preorder-campaign/index.ts'
import type { Plan } from './placement-plan.ts'

const preorderConflict = (change: PreorderChange) => {
  const messages: Record<PreorderChange['kind'], string> = {
    in_stock: 'Sản phẩm đã có hàng sẵn, bạn có thể mua ngay',
    price: 'Giá đã thay đổi, hãy xem lại trước khi đặt trước',
    deposit: 'Mức cọc đã thay đổi, hãy xem lại trước khi đặt trước',
    campaign: 'Đợt đặt trước đã thay đổi hoặc đã đóng',
    sold_out: 'Không còn đủ suất đặt trước cho số lượng này',
    discontinued: 'Sản phẩm không còn bán',
  }
  const details: PreorderConflictDetails = { change }
  return new AppError(409, ErrorCode.CONFLICT, messages[change.kind], undefined, details)
}

/**
 * Pre-order of one variant, outside the cart (ADR 0012): one line, deposit first. A pending order takes campaign
 * allocation, not stock (ADR 0013). Stops at the first change the customer must review.
 */
export const preorderPlan: Plan<z.output<typeof PreorderRequest>> = {
  verb: 'đặt trước',
  saleType: 'preorder',
  tooManyAttempts: 'Bạn đã đặt quá nhiều lần, vui lòng thử lại sau',
  checkInput(input) {
    if (input.acceptPreorderPolicy !== true) {
      throw invalidField('acceptPreorderPolicy', 'Cần đồng ý với chính sách đặt trước')
    }
  },
  async claim(tx, input) {
    const preorderPolicy = await findCurrentPreorderPolicy(tx)
    if (!preorderPolicy) {
      throw new AppError(
        503,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Chưa thể đặt trước vì chính sách đặt trước chưa được công bố',
      )
    }

    const { found, campaign, problem } = await checkPreorder(tx, input.variantId, input.quantity, { lock: true })
    const variant = found.variant
    if (problem === 'discontinued' || !variant) throw preorderConflict({ kind: 'discontinued' })
    if (problem === 'in_stock') throw preorderConflict({ kind: 'in_stock' })
    // The campaign seen has closed or been replaced: the delivery promise may differ.
    if (!campaign || campaign.id !== input.campaignId) throw preorderConflict({ kind: 'campaign' })
    if (variant.price !== input.price) {
      throw preorderConflict({ kind: 'price', from: input.price, to: variant.price })
    }
    if (campaign.depositPercent !== input.depositPercent) {
      throw preorderConflict({ kind: 'deposit', from: input.depositPercent, to: campaign.depositPercent })
    }
    if (problem === 'sold_out') throw preorderConflict({ kind: 'sold_out' })

    const snapshot = found.snapshot!
    return {
      // Single line, so it takes the whole discount; nothing is reserved.
      lines: [
        {
          position: 0,
          variantId: variant.id,
          sku: variant.sku,
          productName: snapshot.name,
          attributes: variant.attributes,
          image: storedImageOf(found) ?? undefined,
          price: variant.price,
          quantity: input.quantity,
        },
      ],
      voucherLines: [
        {
          variantId: variant.id,
          brandId: snapshot.brandId,
          categoryId: snapshot.categoryId,
          price: variant.price,
          quantity: input.quantity,
        },
      ],
      subtotal: variant.price * input.quantity,
      variants: [found],
      depositPercent: campaign.depositPercent,
      voucherConflictDetails: (voucher): PreorderConflictDetails => ({ voucher }),
      settle: ({ depositAmount }) => ({
        orderColumns: {
          kind: 'preorder',
          preorderCampaignId: campaign.id,
          depositPercent: campaign.depositPercent,
          depositAmount: depositAmount!,
          deliveryFrom: campaign.deliveryFrom,
          deliveryTo: campaign.deliveryTo,
          remainderDays: campaign.remainderDays,
        },
        extraPolicyVersionIds: [preorderPolicy.id],
        eventData: { depositAmount: depositAmount!, campaignId: campaign.id },
        payment: {
          purpose: 'deposit',
          amount: depositAmount!,
          description: (code) => `Đặt cọc đơn hàng #${code}`,
        },
      }),
    }
  },
}
