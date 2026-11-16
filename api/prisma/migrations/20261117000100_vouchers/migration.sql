-- M5 ticket 02: mã giảm giá (GLOSSARY "Mã giảm giá", "Lượt dùng").

-- CreateEnum
CREATE TYPE "voucher_kind" AS ENUM ('fixed', 'percent');

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "voucher_id" UUID;

-- CreateTable
CREATE TABLE "voucher" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "voucher_kind" NOT NULL,
    "amount" BIGINT,
    "percent" INTEGER,
    "max_discount" BIGINT,
    "min_subtotal" BIGINT NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "sale_types" "order_kind"[],
    "total_limit" INTEGER,
    "per_customer_limit" INTEGER NOT NULL DEFAULT 1,
    "disabled_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_brand" (
    "voucher_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,

    CONSTRAINT "voucher_brand_pkey" PRIMARY KEY ("voucher_id","brand_id")
);

-- CreateTable
CREATE TABLE "voucher_category" (
    "voucher_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "voucher_category_pkey" PRIMARY KEY ("voucher_id","category_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voucher_code_key" ON "voucher"("code");

-- CreateIndex
CREATE INDEX "voucher_created_at_idx" ON "voucher"("created_at");

-- CreateIndex
CREATE INDEX "voucher_brand_brand_id_idx" ON "voucher_brand"("brand_id");

-- CreateIndex
CREATE INDEX "voucher_category_category_id_idx" ON "voucher_category"("category_id");

-- CreateIndex
CREATE INDEX "order_voucher_id_idx" ON "order"("voucher_id");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_brand" ADD CONSTRAINT "voucher_brand_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_brand" ADD CONSTRAINT "voucher_brand_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_category" ADD CONSTRAINT "voucher_category_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_category" ADD CONSTRAINT "voucher_category_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ràng buộc nghiệp vụ Prisma không diễn đạt được. Lượt (tổng, mỗi khách) tính từ đơn nên không kiểm ở đây.
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_code_check" CHECK ("code" ~ '^[A-Z0-9]{4,20}$');
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_kind_check" CHECK (
    ("kind" = 'fixed' AND "amount" >= 1000 AND "percent" IS NULL AND "max_discount" IS NULL)
    OR ("kind" = 'percent' AND "percent" BETWEEN 1 AND 50 AND "max_discount" >= 1000 AND "amount" IS NULL)
);
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_min_subtotal_check" CHECK ("min_subtotal" >= 0);
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_period_check" CHECK ("ends_at" > "starts_at");
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_sale_types_check" CHECK ("sale_types" IS NOT NULL AND cardinality("sale_types") >= 1);
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_limits_check" CHECK (
    ("total_limit" IS NULL OR "total_limit" >= 1) AND "per_customer_limit" >= 1
);
