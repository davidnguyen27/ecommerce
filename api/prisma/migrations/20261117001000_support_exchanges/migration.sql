-- Đổi hàng (GLOSSARY "Đổi hàng", ADR 0015, spec M6b ticket 05): dòng yêu cầu ghi biến thể khách đang giữ và biến thể đổi
-- sang cùng số đang giữ cho nó; yêu cầu ghi lần giao hàng đổi và cờ quá hạn gửi hàng cũ.

-- Biến thể khách đang giữ lúc gửi yêu cầu (lần đổi gần nhất đã giao, hay biến thể gốc): kho nhận về đúng biến thể này.
ALTER TABLE "support_request_line" ADD COLUMN "held_variant_id" UUID;
UPDATE "support_request_line" l SET "held_variant_id" = ol."variant_id"
FROM "order_line" ol WHERE ol."id" = l."order_line_id";
ALTER TABLE "support_request_line" ALTER COLUMN "held_variant_id" SET NOT NULL;

ALTER TABLE "support_request_line" ADD COLUMN "exchange_variant_id" UUID,
ADD COLUMN "reserved_quantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "support_request_line" ADD CONSTRAINT "support_request_line_exchange_check" CHECK (
    "reserved_quantity" BETWEEN 0 AND "quantity"
    AND ("exchange_variant_id" IS NOT NULL OR "reserved_quantity" = 0)
    AND ("exchange_variant_id" IS NULL OR "exchange_variant_id" <> "held_variant_id")
);

-- Lần giao hàng đổi: có đủ ba trường hay không trường nào; chỉ sau khi đã nhận hàng cũ (ADR 0015).
ALTER TABLE "support_request" ADD COLUMN "exchange_carrier" TEXT,
ADD COLUMN "exchange_tracking_number" TEXT,
ADD COLUMN "exchange_handed_over_at" TIMESTAMP(3),
ADD COLUMN "exchange_overdue_at" TIMESTAMP(3);

ALTER TABLE "support_request" ADD CONSTRAINT "support_request_exchange_check" CHECK (
    ("exchange_handed_over_at" IS NULL) = ("exchange_carrier" IS NULL)
    AND ("exchange_handed_over_at" IS NULL) = ("exchange_tracking_number" IS NULL)
    AND ("exchange_handed_over_at" IS NULL OR "received_at" IS NOT NULL)
    AND (("exchange_handed_over_at" IS NULL AND "exchange_overdue_at" IS NULL) OR "kind" = 'exchange')
);

CREATE INDEX "support_request_exchange_overdue_idx" ON "support_request"("kind", "decision", "received_at");

-- AddForeignKey
ALTER TABLE "support_request_line" ADD CONSTRAINT "support_request_line_held_variant_id_fkey" FOREIGN KEY ("held_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_request_line" ADD CONSTRAINT "support_request_line_exchange_variant_id_fkey" FOREIGN KEY ("exchange_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
