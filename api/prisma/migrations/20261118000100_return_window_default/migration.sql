-- Chủ doanh nghiệp chốt hạn đổi trả 14 ngày từ lúc giao cho mọi nhóm hàng (2026-11-18). Nhóm đã được cấu hình thì giữ
-- nguyên; sửa sau ở trang "Hạn đổi trả".
INSERT INTO "return_window" ("product_type", "days", "updated_at")
SELECT t, 14, CURRENT_TIMESTAMP FROM unnest(enum_range(NULL::"product_type")) AS t
ON CONFLICT ("product_type") DO NOTHING;
