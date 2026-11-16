-- M4 ticket 05: lúc cọc thành công của đơn đặt trước; ticket 06 chia hàng về theo thứ tự này.
ALTER TABLE "order" ADD COLUMN "deposit_paid_at" TIMESTAMP(3);

-- Đơn hàng sẵn không bao giờ đi qua `deposit_paid` và không có lúc cọc. Đơn đặt trước có lúc cọc khi và chỉ khi đã qua
-- bước cọc (đang `deposit_paid` hoặc đã `paid`).
ALTER TABLE "order" ADD CONSTRAINT "order_deposit_paid_check" CHECK (
  ("kind" = 'standard' AND "deposit_paid_at" IS NULL AND "payment_status" <> 'deposit_paid')
  OR ("kind" = 'preorder' AND ("deposit_paid_at" IS NOT NULL) = ("payment_status" IN ('deposit_paid', 'paid')))
);

-- Hàng đợi chia hàng của ticket 06: đơn đã cọc theo thứ tự cọc.
CREATE INDEX "order_deposit_paid_at_idx" ON "order"("deposit_paid_at");
