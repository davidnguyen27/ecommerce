-- CreateEnum
CREATE TYPE "reconciliation_resolution" AS ENUM ('restored', 'handled_externally');

-- Cách kế toán đóng mục cần đối soát: khôi phục đơn, hoặc đã xử lý ngoài hệ thống (ghi chú bắt buộc).
ALTER TABLE "reconciliation_item" ADD COLUMN "resolution" "reconciliation_resolution",
ADD COLUMN "note" TEXT,
ADD COLUMN "resolved_by_id" UUID,
ADD COLUMN "resolved_at" TIMESTAMP(3);

ALTER TABLE "reconciliation_item" ADD CONSTRAINT "reconciliation_item_resolution_check" CHECK (
    ("status" = 'resolved') = ("resolution" IS NOT NULL)
    AND ("resolution" IS NULL) = ("resolved_by_id" IS NULL)
    AND ("resolution" IS NULL) = ("resolved_at" IS NULL)
    AND ("resolution" IS DISTINCT FROM 'handled_externally' OR length(btrim("note")) > 0)
);

-- AddForeignKey
ALTER TABLE "reconciliation_item" ADD CONSTRAINT "reconciliation_item_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
