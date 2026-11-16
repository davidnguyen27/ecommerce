-- M4 ticket 01: một đơn có thể có nhiều link thanh toán, mỗi link một mục đích (trả đủ, cọc, phần còn lại).
-- Mã đơn bên cổng chuyển từ "order"."gateway_reference" sang bảng link.

-- CreateEnum
CREATE TYPE "payment_purpose" AS ENUM ('full', 'deposit', 'remainder');

-- Mỗi lần tạo link ở cổng cho đơn. Mã đơn bên cổng unique: ghi nhận tiền về tìm link theo mã này.
CREATE TABLE "payment_link" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "purpose" "payment_purpose" NOT NULL,
    "amount" BIGINT NOT NULL,
    "gateway_reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_link_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_link_amount_check" CHECK ("amount" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_link_gateway_reference_key" ON "payment_link"("gateway_reference");

-- CreateIndex
CREATE INDEX "payment_link_order_id_created_at_idx" ON "payment_link"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "payment_link" ADD CONSTRAINT "payment_link_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Đơn M3 đã có mã bên cổng: một link trả đủ, số tiền bằng tổng phải trả, hạn 15 phút từ lúc đặt như hạn giữ hàng.
INSERT INTO "payment_link" ("id", "order_id", "purpose", "amount", "gateway_reference", "created_at", "expires_at")
SELECT gen_random_uuid(), "id", 'full', "total", "gateway_reference", "created_at", "created_at" + INTERVAL '15 minutes'
FROM "order"
WHERE "gateway_reference" IS NOT NULL;

DROP INDEX "order_gateway_reference_key";
ALTER TABLE "order" DROP COLUMN "gateway_reference";

-- Giao dịch cũ đều là trả đủ. ADD COLUMN có DEFAULT không chạy trigger UPDATE nên bảng chỉ-thêm-mới vẫn thêm được cột;
-- bỏ DEFAULT ngay sau đó để mọi giao dịch mới phải ghi rõ mục đích.
ALTER TABLE "payment_transaction" ADD COLUMN "purpose" "payment_purpose" NOT NULL DEFAULT 'full';
ALTER TABLE "payment_transaction" ALTER COLUMN "purpose" DROP DEFAULT;
