-- Lời đồng ý chính sách bảo mật của khách vãng lai khi đặt mua: phiên bản hiện hành lúc đặt, thời điểm là "created_at".
-- Khách đã đăng nhập đồng ý lúc đăng ký (customer_consent) nên cột này để trống.
ALTER TABLE "order" ADD COLUMN "privacy_policy_version_id" UUID;
ALTER TABLE "order" ADD CONSTRAINT "order_privacy_consent_check" CHECK ("customer_id" IS NOT NULL OR "privacy_policy_version_id" IS NOT NULL);

-- Thông tin xuất hóa đơn công ty (snapshot lúc đặt): có đủ cả ba hoặc không có gì.
ALTER TABLE "order" ADD COLUMN "invoice_company_name" TEXT;
ALTER TABLE "order" ADD COLUMN "invoice_tax_code" TEXT;
ALTER TABLE "order" ADD COLUMN "invoice_address" TEXT;
ALTER TABLE "order" ADD CONSTRAINT "order_invoice_check" CHECK (
  ("invoice_company_name" IS NULL) = ("invoice_tax_code" IS NULL)
  AND ("invoice_tax_code" IS NULL) = ("invoice_address" IS NULL)
);

-- CreateIndex
CREATE INDEX "order_privacy_policy_version_id_idx" ON "order"("privacy_policy_version_id");

-- Đếm đơn đang chờ thanh toán theo email và theo số điện thoại (giới hạn tần suất đặt mua).
-- CreateIndex
CREATE INDEX "order_email_status_idx" ON "order"("email", "status");

-- CreateIndex
CREATE INDEX "order_phone_status_idx" ON "order"("phone", "status");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_privacy_policy_version_id_fkey" FOREIGN KEY ("privacy_policy_version_id") REFERENCES "content_page_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
