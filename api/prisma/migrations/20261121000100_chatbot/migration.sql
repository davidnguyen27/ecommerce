-- Chatbot (spec M8, ADR 0017): cài đặt, cuộc trò chuyện, tin nhắn và lượt gọi model theo ngày.

-- CreateEnum
CREATE TYPE "chat_role" AS ENUM ('customer', 'assistant');

-- CreateTable
CREATE TABLE "chatbot_setting" (
    "id" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "response_time_note" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatbot_setting_pkey" PRIMARY KEY ("id"),
    -- Tối đa một dòng.
    CONSTRAINT "chatbot_setting_single_row" CHECK ("id"),
    CONSTRAINT "chatbot_setting_response_time_note_check" CHECK (length("response_time_note") <= 300)
);

-- CreateTable
CREATE TABLE "chat_conversation" (
    "id" UUID NOT NULL,
    "ip_hash" TEXT NOT NULL,
    "customer_message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_conversation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_conversation_customer_message_count_check" CHECK ("customer_message_count" >= 0)
);

-- CreateTable
CREATE TABLE "chat_message" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "chat_role" NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "prompt_version" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_pkey" PRIMARY KEY ("id"),
    -- Tin của chatbot luôn ghi model và phiên bản prompt; chỉ tin của khách mới mang lỗi của lượt.
    CONSTRAINT "chat_message_role_check" CHECK (
        ("role" = 'assistant') = ("model" IS NOT NULL AND "prompt_version" IS NOT NULL)
        AND ("role" = 'customer' OR "error" IS NULL)
    ),
    CONSTRAINT "chat_message_error_check" CHECK ("error" IS NULL OR "error" IN ('exhausted', 'failed'))
);

-- CreateTable
CREATE TABLE "chat_usage_day" (
    "day" DATE NOT NULL,
    "model" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "rate_limited" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "chat_usage_day_pkey" PRIMARY KEY ("day", "model")
);

-- CreateIndex
CREATE INDEX "chat_conversation_last_message_at_idx" ON "chat_conversation"("last_message_at");

-- CreateIndex
CREATE INDEX "chat_message_conversation_id_created_at_idx" ON "chat_message"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_message_created_at_idx" ON "chat_message"("created_at");

-- AddForeignKey
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
