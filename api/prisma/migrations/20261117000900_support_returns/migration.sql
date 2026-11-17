-- Trả hàng (GLOSSARY "Trả hàng", spec M6b ticket 04): dòng của yêu cầu, quyết định chấp nhận/từ chối, lúc nhận hàng về,
-- hạn đổi trả chụp lúc gửi; sổ xuất nhập và khoản hoàn trỏ được về yêu cầu.

-- CreateEnum
CREATE TYPE "support_return_reason" AS ENUM ('defective', 'wrong_fit', 'not_as_described', 'other');

-- CreateEnum
CREATE TYPE "support_decision" AS ENUM ('accepted', 'rejected');

-- AlterEnum
ALTER TYPE "refund_origin" ADD VALUE 'return';

-- Quyết định, nhận hàng, hạn đổi trả.
ALTER TABLE "support_request" ADD COLUMN "decision" "support_decision",
ADD COLUMN "decided_by_id" UUID,
ADD COLUMN "decided_at" TIMESTAMP(3),
ADD COLUMN "received_at" TIMESTAMP(3),
ADD COLUMN "received_by_id" UUID,
ADD COLUMN "return_window_days" INTEGER,
ADD COLUMN "delivered_at" TIMESTAMP(3),
ADD COLUMN "overdue_days" INTEGER;

ALTER TABLE "support_request" ADD CONSTRAINT "support_request_decision_check" CHECK (
    ("decision" IS NULL) = ("decided_by_id" IS NULL)
    AND ("decision" IS NULL) = ("decided_at" IS NULL)
    -- Chỉ nhận hàng về sau khi đã chấp nhận.
    AND ("received_at" IS NULL OR "decision" = 'accepted')
    AND ("received_at" IS NULL) = ("received_by_id" IS NULL)
    AND ("return_window_days" IS NULL OR "return_window_days" >= 0)
    AND ("overdue_days" IS NULL OR "overdue_days" >= 0)
);

-- CreateTable
CREATE TABLE "support_request_line" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" "support_return_reason",
    "restocked_quantity" INTEGER NOT NULL DEFAULT 0,
    "written_off_quantity" INTEGER NOT NULL DEFAULT 0,
    "received_variant_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_request_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_request_line_quantity_check" CHECK (
        "quantity" >= 1
        AND "restocked_quantity" >= 0 AND "written_off_quantity" >= 0
        AND "restocked_quantity" + "written_off_quantity" <= "quantity"
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "support_request_line_request_id_order_line_id_key" ON "support_request_line"("request_id", "order_line_id");

-- CreateIndex
CREATE INDEX "support_request_line_order_line_id_idx" ON "support_request_line"("order_line_id");

-- Hạn đổi trả theo nhóm hàng; không có dòng là không cảnh báo.
CREATE TABLE "return_window" (
    "product_type" "product_type" NOT NULL,
    "days" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_window_pkey" PRIMARY KEY ("product_type"),
    CONSTRAINT "return_window_days_check" CHECK ("days" BETWEEN 0 AND 365)
);

-- Sổ xuất nhập: dòng hàng trả về (và hàng đổi giao đi ở ticket 05) trỏ thêm về yêu cầu hỗ trợ.
ALTER TABLE "stock_movement" ADD COLUMN "support_request_id" UUID;
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_support_request_check"
  CHECK ("support_request_id" IS NULL OR "kind"::text IN ('sale', 'return'));
CREATE INDEX "stock_movement_support_request_id_idx" ON "stock_movement"("support_request_id");

-- Khoản hoàn sinh từ trả hàng trỏ về yêu cầu. So theo text vì giá trị enum vừa thêm chưa dùng được trong cùng transaction.
ALTER TABLE "refund" ADD COLUMN "support_request_id" UUID;
ALTER TABLE "refund" DROP CONSTRAINT "refund_origin_check";
ALTER TABLE "refund" ADD CONSTRAINT "refund_origin_check" CHECK (
    ("origin" = 'reconciliation') = ("reconciliation_item_id" IS NOT NULL)
    AND ("origin" = 'retry') = ("retry_of_id" IS NOT NULL)
    AND ("origin"::text = 'return') = ("support_request_id" IS NOT NULL)
);
CREATE INDEX "refund_support_request_id_idx" ON "refund"("support_request_id");

-- AddForeignKey
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_request_line" ADD CONSTRAINT "support_request_line_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "support_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_request_line" ADD CONSTRAINT "support_request_line_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_request_line" ADD CONSTRAINT "support_request_line_received_variant_id_fkey" FOREIGN KEY ("received_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_support_request_id_fkey" FOREIGN KEY ("support_request_id") REFERENCES "support_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund" ADD CONSTRAINT "refund_support_request_id_fkey" FOREIGN KEY ("support_request_id") REFERENCES "support_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
