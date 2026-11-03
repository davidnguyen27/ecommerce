-- AlterEnum
ALTER TYPE "stock_movement_kind" ADD VALUE 'sale';

-- Xuất bán (GLOSSARY): hàng của một đơn rời kho lúc bàn giao vận chuyển; dòng sổ loại này luôn trỏ về đơn, loại khác thì không.
-- So sánh theo text vì giá trị enum vừa thêm chưa dùng được trong cùng transaction.
ALTER TABLE "stock_movement" ADD COLUMN "order_id" UUID;
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_order_check" CHECK (("kind"::text = 'sale') = ("order_id" IS NOT NULL));
CREATE INDEX "stock_movement_order_id_idx" ON "stock_movement"("order_id");
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bàn giao vận chuyển: một đơn = một kiện = một mã vận đơn. Có đủ cả ba khi và chỉ khi đơn đã bàn giao (kể cả đã giao,
-- giao thất bại).
ALTER TABLE "order" ADD COLUMN "carrier" TEXT,
ADD COLUMN "tracking_number" TEXT,
ADD COLUMN "handed_over_at" TIMESTAMP(3);

ALTER TABLE "order" ADD CONSTRAINT "order_handover_check" CHECK (
    ("fulfillment_status" IN ('handed_over', 'delivered', 'failed')) = ("handed_over_at" IS NOT NULL)
    AND ("handed_over_at" IS NULL) = ("carrier" IS NULL)
    AND ("handed_over_at" IS NULL) = ("tracking_number" IS NULL)
);
