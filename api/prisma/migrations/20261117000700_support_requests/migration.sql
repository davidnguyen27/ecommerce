-- Yêu cầu hỗ trợ (GLOSSARY "Hậu mãi", spec M6b): việc khách nhờ cửa hàng xử lý, có chuỗi tin nhắn, người phụ trách và
-- trạng thái. Phần riêng của từng loại (trả, đổi, bảo hành) do các ticket sau thêm.

-- CreateEnum
CREATE TYPE "support_request_kind" AS ENUM ('cancel', 'return', 'exchange', 'warranty', 'other');

-- CreateEnum
CREATE TYPE "support_request_status" AS ENUM ('new', 'in_progress', 'waiting_customer', 'resolved', 'rejected');

-- CreateEnum
CREATE TYPE "support_author" AS ENUM ('customer', 'staff', 'system');

-- Mã khách thấy (#YC1001), sequence riêng như mã đơn.
CREATE SEQUENCE "support_request_code_seq" START WITH 1001;

-- CreateTable
CREATE TABLE "support_request" (
    "id" UUID NOT NULL,
    "code" INTEGER NOT NULL DEFAULT nextval('support_request_code_seq'),
    "kind" "support_request_kind" NOT NULL,
    "status" "support_request_status" NOT NULL DEFAULT 'new',
    "subject" TEXT NOT NULL,
    "order_id" UUID,
    "customer_id" UUID,
    "contact_email" TEXT NOT NULL,
    "contact_name" TEXT,
    "assignee_id" UUID,
    "created_by" "support_author" NOT NULL,
    "created_by_staff_id" UUID,
    "previous_request_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "support_request_pkey" PRIMARY KEY ("id"),
    -- Mọi loại trừ "khác" gắn với một đơn; yêu cầu luôn thuộc về một đơn hoặc một tài khoản để khách theo dõi được.
    CONSTRAINT "support_request_order_check" CHECK (
        ("kind" = 'other' OR "order_id" IS NOT NULL)
        AND ("order_id" IS NOT NULL OR "customer_id" IS NOT NULL)
    ),
    CONSTRAINT "support_request_subject_check" CHECK (length(btrim("subject")) BETWEEN 1 AND 200),
    -- Đã xong hay từ chối thì có lúc kết thúc, và ngược lại.
    CONSTRAINT "support_request_resolved_check" CHECK (
        ("status" IN ('resolved', 'rejected')) = ("resolved_at" IS NOT NULL)
    ),
    -- Nhân viên tạo hộ thì ghi nhân viên nào.
    CONSTRAINT "support_request_created_by_check" CHECK (("created_by" = 'staff') = ("created_by_staff_id" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "support_message" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "author" "support_author" NOT NULL,
    "staff_id" UUID,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_message_body_check" CHECK (length(btrim("body")) BETWEEN 1 AND 5000),
    -- Tin của nhân viên ghi nhân viên nào; ghi chú nội bộ chỉ nhân viên viết.
    CONSTRAINT "support_message_author_check" CHECK (
        ("author" = 'staff') = ("staff_id" IS NOT NULL)
        AND (NOT "internal" OR "author" = 'staff')
    )
);

ALTER SEQUENCE "support_request_code_seq" OWNED BY "support_request"."code";

-- CreateIndex
CREATE UNIQUE INDEX "support_request_code_key" ON "support_request"("code");

-- CreateIndex
CREATE INDEX "support_request_order_id_idx" ON "support_request"("order_id");

-- CreateIndex
CREATE INDEX "support_request_customer_id_idx" ON "support_request"("customer_id");

-- CreateIndex
CREATE INDEX "support_request_status_created_at_idx" ON "support_request"("status", "created_at");

-- CreateIndex
CREATE INDEX "support_request_assignee_id_idx" ON "support_request"("assignee_id");

-- CreateIndex
CREATE INDEX "support_message_request_id_created_at_idx" ON "support_message"("request_id", "created_at");

-- AddForeignKey
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_previous_request_id_fkey" FOREIGN KEY ("previous_request_id") REFERENCES "support_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "support_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
