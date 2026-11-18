-- Khoản hoàn tạo lại (`origin = retry`) từ một khoản hoàn trả hàng thất bại giữ liên kết với yêu cầu trả, để yêu cầu và
-- khách vẫn thấy khoản hoàn mới. `return` vẫn bắt buộc có yêu cầu; ngoài `return` và `retry` thì không có.
ALTER TABLE "refund" DROP CONSTRAINT "refund_origin_check";
ALTER TABLE "refund" ADD CONSTRAINT "refund_origin_check" CHECK (
    ("origin" = 'reconciliation') = ("reconciliation_item_id" IS NOT NULL)
    AND ("origin" = 'retry') = ("retry_of_id" IS NOT NULL)
    AND ("origin"::text <> 'return' OR "support_request_id" IS NOT NULL)
    AND ("support_request_id" IS NULL OR "origin"::text IN ('return', 'retry'))
);
