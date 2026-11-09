-- Mục lệch tiền tự đóng khi khoản sau làm tổng đã nhận khớp tổng đơn: hệ thống đóng, không có nhân viên.
ALTER TYPE "reconciliation_resolution" ADD VALUE 'settled_by_payment';

-- Không nhắc tới giá trị mới (chưa dùng được trong cùng transaction): nhân viên đóng thì có người đóng, hệ thống thì không.
ALTER TABLE "reconciliation_item" DROP CONSTRAINT "reconciliation_item_resolution_check";
ALTER TABLE "reconciliation_item" ADD CONSTRAINT "reconciliation_item_resolution_check" CHECK (
    ("status" = 'resolved') = ("resolution" IS NOT NULL)
    AND ("resolution" IS NULL) = ("resolved_at" IS NULL)
    AND COALESCE("resolution" IN ('restored', 'handled_externally'), false) = ("resolved_by_id" IS NOT NULL)
    AND ("resolution" IS DISTINCT FROM 'handled_externally' OR length(btrim("note")) > 0)
);
