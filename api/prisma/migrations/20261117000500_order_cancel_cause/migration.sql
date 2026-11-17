-- Lý do hủy đơn đã nhận tiền (M6a): khách đổi ý, quá hạn trả phần còn lại, không nhập được hàng, giao thất bại, khác.
-- `cancel_reason` vẫn là `staff`; lý do chi tiết và ghi chú nội bộ nằm ở hai cột mới.

-- CreateEnum
CREATE TYPE "order_cancel_cause" AS ENUM ('changed_mind', 'remainder_overdue', 'supply_failed', 'delivery_failed', 'other');

-- AlterTable
ALTER TABLE "order" ADD COLUMN "cancel_cause" "order_cancel_cause",
ADD COLUMN "cancel_note" TEXT;

-- Hủy đơn đã nhận tiền không đổi trạng thái thanh toán (ADR 0014), nên "đã nhận tiền" là trạng thái thanh toán khác
-- `unpaid`. Có lý do khi và chỉ khi đơn bị nhân viên hủy lúc đã nhận tiền; ghi chú chỉ có khi có lý do.
ALTER TABLE "order" ADD CONSTRAINT "order_cancel_cause_check" CHECK (
    ("cancel_cause" IS NOT NULL) = ("status" = 'cancelled' AND "payment_status" <> 'unpaid')
    AND ("cancel_cause" IS NULL OR "cancel_reason" = 'staff')
    AND ("cancel_note" IS NULL OR "cancel_cause" IS NOT NULL)
);
