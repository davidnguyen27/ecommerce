-- CreateEnum
CREATE TYPE "order_cancel_reason" AS ENUM ('expired', 'customer', 'staff');

-- Vì sao và lúc nào đơn bị hủy: trang đơn phân biệt hết hạn với tự hủy; khôi phục đơn (ticket 10) cần biết đơn hủy vì gì.
ALTER TABLE "order" ADD COLUMN "cancel_reason" "order_cancel_reason",
ADD COLUMN "cancelled_at" TIMESTAMP(3);

ALTER TABLE "order" ADD CONSTRAINT "order_cancellation_check" CHECK (
    ("status" = 'cancelled') = ("cancel_reason" IS NOT NULL)
    AND ("cancel_reason" IS NULL) = ("cancelled_at" IS NULL)
);
