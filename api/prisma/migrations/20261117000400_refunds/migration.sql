-- Hoàn tiền (GLOSSARY, ADR 0014): khoản trả lại cho khách gắn với đơn, theo dõi tới khi có kết quả; tách khỏi hủy đơn
-- và khỏi trạng thái thanh toán.

-- AlterEnum
ALTER TYPE "reconciliation_resolution" ADD VALUE 'refunded';

-- CreateEnum
CREATE TYPE "refund_origin" AS ENUM ('cancellation', 'reconciliation', 'retry');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('pending', 'processing', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "refund_method" AS ENUM ('vnpay', 'manual');

-- CreateTable
CREATE TABLE "refund" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "origin" "refund_origin" NOT NULL,
    "reconciliation_item_id" UUID,
    "retry_of_id" UUID,
    "status" "refund_status" NOT NULL DEFAULT 'pending',
    "method" "refund_method",
    "payment_transaction_id" UUID,
    "bank_reference" TEXT,
    "transferred_on" DATE,
    "note" TEXT,
    "gateway_payload" JSONB,
    "created_by_id" UUID NOT NULL,
    "executed_by_id" UUID,
    "executed_at" TIMESTAMP(3),
    "settled_by_id" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refund_amount_check" CHECK ("amount" > 0),
    -- Nguồn của khoản hoàn trỏ đúng một chỗ.
    CONSTRAINT "refund_origin_check" CHECK (
        ("origin" = 'reconciliation') = ("reconciliation_item_id" IS NOT NULL)
        AND ("origin" = 'retry') = ("retry_of_id" IS NOT NULL)
    ),
    -- Chưa thực hiện thì chưa có cách hoàn; đã thực hiện thì có người và lúc thực hiện. Có kết quả thì có lúc xong.
    -- Hoàn qua cổng gắn một giao dịch gốc; hoàn thủ công đi thẳng tới đã hoàn, có mã ngân hàng và ngày chuyển.
    CONSTRAINT "refund_status_check" CHECK (
        ("status" = 'pending') = ("method" IS NULL)
        AND ("method" IS NULL) = ("executed_by_id" IS NULL)
        AND ("method" IS NULL) = ("executed_at" IS NULL)
        AND ("status" IN ('succeeded', 'failed')) = ("completed_at" IS NOT NULL)
        AND COALESCE("method" = 'vnpay', false) = ("payment_transaction_id" IS NOT NULL)
        AND COALESCE("method" = 'manual', false) = ("bank_reference" IS NOT NULL)
        AND COALESCE("method" = 'manual', false) = ("transferred_on" IS NOT NULL)
        AND ("method" IS DISTINCT FROM 'manual' OR "status" = 'succeeded')
        AND ("settled_by_id" IS NULL OR "status" IN ('succeeded', 'failed'))
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "refund_reconciliation_item_id_key" ON "refund"("reconciliation_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_retry_of_id_key" ON "refund"("retry_of_id");

-- CreateIndex
CREATE INDEX "refund_order_id_idx" ON "refund"("order_id");

-- CreateIndex
CREATE INDEX "refund_status_idx" ON "refund"("status");

-- CreateIndex
CREATE INDEX "refund_payment_transaction_id_idx" ON "refund"("payment_transaction_id");

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_reconciliation_item_id_fkey" FOREIGN KEY ("reconciliation_item_id") REFERENCES "reconciliation_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_retry_of_id_fkey" FOREIGN KEY ("retry_of_id") REFERENCES "refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_executed_by_id_fkey" FOREIGN KEY ("executed_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_settled_by_id_fkey" FOREIGN KEY ("settled_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Kế toán giải quyết bằng hoàn tiền thì có người đóng, như khôi phục và xử lý ngoài hệ thống. So theo text vì giá trị
-- enum vừa thêm chưa dùng được trong cùng transaction.
ALTER TABLE "reconciliation_item" DROP CONSTRAINT "reconciliation_item_resolution_check";
ALTER TABLE "reconciliation_item" ADD CONSTRAINT "reconciliation_item_resolution_check" CHECK (
    ("status" = 'resolved') = ("resolution" IS NOT NULL)
    AND ("resolution" IS NULL) = ("resolved_at" IS NULL)
    AND COALESCE("resolution"::text IN ('restored', 'handled_externally', 'refunded'), false) = ("resolved_by_id" IS NOT NULL)
    AND ("resolution" IS DISTINCT FROM 'handled_externally' OR length(btrim("note")) > 0)
);
