-- Chuyển nhân viên từ chatbot (spec M8 ticket 05): khách vãng lai chưa có đơn được gửi yêu cầu loại "khác" chỉ với tên
-- và email (GLOSSARY "Yêu cầu hỗ trợ"); theo dõi qua link có token riêng của yêu cầu.

-- AlterEnum
ALTER TYPE "support_author" ADD VALUE 'chatbot';

-- Yêu cầu không gắn đơn, không gắn tài khoản chỉ có khi chatbot tạo. So sánh qua ::text vì giá trị enum vừa thêm chưa
-- dùng được làm hằng trong cùng transaction.
ALTER TABLE "support_request" DROP CONSTRAINT "support_request_order_check";
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_order_check" CHECK (
    ("kind" = 'other' OR "order_id" IS NOT NULL)
    AND ("order_id" IS NOT NULL OR "customer_id" IS NOT NULL OR "created_by"::text = 'chatbot')
);

-- CreateTable
CREATE TABLE "support_request_token" (
    "token_hash" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_request_token_pkey" PRIMARY KEY ("token_hash")
);

-- AlterTable
ALTER TABLE "chat_conversation" ADD COLUMN "support_request_id" UUID;

-- CreateIndex
CREATE INDEX "support_request_token_request_id_idx" ON "support_request_token"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversation_support_request_id_key" ON "chat_conversation"("support_request_id");

-- AddForeignKey
ALTER TABLE "support_request_token" ADD CONSTRAINT "support_request_token_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "support_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversation" ADD CONSTRAINT "chat_conversation_support_request_id_fkey" FOREIGN KEY ("support_request_id") REFERENCES "support_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
