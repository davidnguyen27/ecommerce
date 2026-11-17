-- Ảnh đính kèm trong yêu cầu hỗ trợ (spec M6b): luôn gắn vào một tin; file nằm ở bucket private, mở qua URL ký có hạn.

-- CreateTable
CREATE TABLE "support_attachment" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_attachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_attachment_content_type_check" CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT "support_attachment_size_check" CHECK ("size_bytes" > 0 AND "width" > 0 AND "height" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "support_attachment_key_key" ON "support_attachment"("key");

-- CreateIndex
CREATE INDEX "support_attachment_request_id_idx" ON "support_attachment"("request_id");

-- CreateIndex
CREATE INDEX "support_attachment_message_id_idx" ON "support_attachment"("message_id");

-- AddForeignKey
ALTER TABLE "support_attachment" ADD CONSTRAINT "support_attachment_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "support_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachment" ADD CONSTRAINT "support_attachment_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "support_message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
