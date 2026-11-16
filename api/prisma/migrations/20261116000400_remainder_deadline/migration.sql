-- M4 ticket 08: nhắc trước hạn trả phần còn lại và gắn cờ quá hạn. Quá hạn không hủy đơn, không mất cọc (M6).
ALTER TABLE "order"
  ADD COLUMN "remainder_reminded_at" TIMESTAMP(3),
  ADD COLUMN "remainder_overdue_at" TIMESTAMP(3);

-- Chỉ đơn đã về hàng (có hạn trả) mới được nhắc hay gắn cờ quá hạn.
ALTER TABLE "order" ADD CONSTRAINT "order_remainder_deadline_check" CHECK (
  "arrived_at" IS NOT NULL OR ("remainder_reminded_at" IS NULL AND "remainder_overdue_at" IS NULL)
);
