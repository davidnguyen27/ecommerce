-- M4 ticket 02: đợt đặt trước (GLOSSARY "Đợt đặt trước", "Suất").

-- CreateEnum
CREATE TYPE "preorder_supply_status" AS ENUM ('not_ordered', 'ordered', 'in_transit', 'issue');

-- Một lần mở nhận cọc cho một sản phẩm. "Mỗi sản phẩm tối đa một đợt đang mở" phụ thuộc thời điểm hiện tại nên không
-- viết được thành constraint: API kiểm trong transaction tạo đợt, khóa dòng sản phẩm.
CREATE TABLE "preorder_campaign" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "deposit_percent" INTEGER NOT NULL,
    "delivery_from" DATE NOT NULL,
    "delivery_to" DATE NOT NULL,
    "closes_at" TIMESTAMP(3) NOT NULL,
    "remainder_days" INTEGER NOT NULL DEFAULT 7,
    "supply_status" "preorder_supply_status" NOT NULL DEFAULT 'not_ordered',
    "supply_note" TEXT NOT NULL DEFAULT '',
    "closed_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preorder_campaign_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "preorder_campaign_deposit_percent_check" CHECK ("deposit_percent" BETWEEN 10 AND 100),
    CONSTRAINT "preorder_campaign_delivery_check" CHECK ("delivery_from" <= "delivery_to"),
    CONSTRAINT "preorder_campaign_remainder_days_check" CHECK ("remainder_days" >= 1)
);

-- Biến thể nhận đặt trong đợt và số suất.
CREATE TABLE "preorder_campaign_variant" (
    "campaign_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "allocation" INTEGER NOT NULL,

    CONSTRAINT "preorder_campaign_variant_pkey" PRIMARY KEY ("campaign_id", "variant_id"),
    CONSTRAINT "preorder_campaign_variant_allocation_check" CHECK ("allocation" >= 1)
);

-- Đơn đặt trước thuộc một đợt; đơn hàng sẵn để trống.
ALTER TABLE "order" ADD COLUMN "preorder_campaign_id" UUID;

-- CreateIndex
CREATE INDEX "preorder_campaign_product_id_closes_at_idx" ON "preorder_campaign"("product_id", "closes_at");

-- CreateIndex
CREATE INDEX "preorder_campaign_created_at_idx" ON "preorder_campaign"("created_at");

-- CreateIndex
CREATE INDEX "preorder_campaign_variant_variant_id_idx" ON "preorder_campaign_variant"("variant_id");

-- CreateIndex
CREATE INDEX "order_preorder_campaign_id_idx" ON "order"("preorder_campaign_id");

-- AddForeignKey
ALTER TABLE "preorder_campaign" ADD CONSTRAINT "preorder_campaign_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preorder_campaign" ADD CONSTRAINT "preorder_campaign_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preorder_campaign_variant" ADD CONSTRAINT "preorder_campaign_variant_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "preorder_campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preorder_campaign_variant" ADD CONSTRAINT "preorder_campaign_variant_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_preorder_campaign_id_fkey" FOREIGN KEY ("preorder_campaign_id") REFERENCES "preorder_campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
