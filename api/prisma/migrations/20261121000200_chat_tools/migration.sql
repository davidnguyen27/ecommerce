-- Công cụ của chatbot (spec M8 ticket 03): tin của chatbot giữ các sản phẩm đã gợi ý (slug và tên, để hiện lại khi
-- mở lại khung chat) và tóm tắt khi chatbot đề nghị chuyển nhân viên (ticket 05 dùng làm tiêu đề yêu cầu).
ALTER TABLE "chat_message" ADD COLUMN "products" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "chat_message" ADD COLUMN "handoff_summary" TEXT;
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_assistant_fields_check" CHECK (
    "role" = 'assistant' OR ("products" = '[]'::jsonb AND "handoff_summary" IS NULL)
);
