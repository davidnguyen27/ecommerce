-- M4 ticket 06: hàng về được chia cho đơn đặt trước đã cọc ngay trong phiếu nhập (ADR 0013).

-- Số đang giữ cho dòng đơn. Đơn hàng sẵn: bằng số lượng từ lúc giữ hàng tới lúc hủy hay bàn giao. Đơn đặt trước: tăng dần
-- theo phiếu nhập. Hủy và bàn giao đưa về 0.
ALTER TABLE "order_line" ADD COLUMN "reserved_quantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_reserved_quantity_check"
  CHECK ("reserved_quantity" BETWEEN 0 AND "quantity");

-- Đơn đang giữ hàng lúc này (ADR 0007): chờ thanh toán, hoặc đã trả mà chưa bàn giao. Mọi đơn có trước ticket 06 đều là
-- đơn hàng sẵn hoặc đơn đặt trước chưa có hàng về.
UPDATE "order_line" l SET "reserved_quantity" = l."quantity"
FROM "order" o
WHERE o."id" = l."order_id" AND o."kind" = 'standard'
  AND (o."status" = 'pending_payment' OR (o."status" = 'processing' AND o."fulfillment_status" IN ('not_prepared', 'preparing')));

-- Đơn đặt trước: lúc mọi cái đã được giữ từ hàng về, và hạn trả phần còn lại tính từ lúc đó.
ALTER TABLE "order"
  ADD COLUMN "arrived_at" TIMESTAMP(3),
  ADD COLUMN "remainder_due_at" TIMESTAMP(3);
ALTER TABLE "order" ADD CONSTRAINT "order_arrival_check" CHECK (
  ("arrived_at" IS NULL AND "remainder_due_at" IS NULL)
  OR ("kind" = 'preorder' AND "deposit_paid_at" IS NOT NULL AND "arrived_at" IS NOT NULL
      AND "remainder_due_at" > "arrived_at")
);
