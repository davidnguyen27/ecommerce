-- M4 ticket 04: đơn đặt trước (ADR 0012). Loại đơn và các trường cọc chụp từ đợt lúc đặt.

-- CreateEnum
CREATE TYPE "order_kind" AS ENUM ('standard', 'preorder');

-- Đơn đã có đều là đơn hàng sẵn.
ALTER TABLE "order"
  ADD COLUMN "kind" "order_kind" NOT NULL DEFAULT 'standard',
  ADD COLUMN "deposit_percent" INTEGER,
  ADD COLUMN "deposit_amount" BIGINT,
  ADD COLUMN "delivery_from" DATE,
  ADD COLUMN "delivery_to" DATE,
  ADD COLUMN "remainder_days" INTEGER;

-- Đơn đặt trước có đủ đợt và các trường cọc; đơn hàng sẵn không có trường nào. Tiền cọc dương, không vượt tiền hàng.
ALTER TABLE "order" ADD CONSTRAINT "order_preorder_check" CHECK (
  (
    "kind" = 'standard'
    AND "preorder_campaign_id" IS NULL AND "deposit_percent" IS NULL AND "deposit_amount" IS NULL
    AND "delivery_from" IS NULL AND "delivery_to" IS NULL AND "remainder_days" IS NULL
  ) OR (
    "kind" = 'preorder'
    AND "preorder_campaign_id" IS NOT NULL
    AND "deposit_percent" BETWEEN 10 AND 100
    AND "deposit_amount" > 0 AND "deposit_amount" <= "subtotal"
    AND "delivery_from" IS NOT NULL AND "delivery_to" IS NOT NULL AND "delivery_from" <= "delivery_to"
    AND "remainder_days" >= 1
  )
);
