-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "variant_status" AS ENUM ('active', 'discontinued');

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "product_type" "product_type" NOT NULL,
    "brand_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model_code" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "usage_care" TEXT NOT NULL DEFAULT '',
    "size_chart" JSONB,
    "origin_statement" TEXT NOT NULL DEFAULT '',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "ground_shipping_only" BOOLEAN NOT NULL DEFAULT false,
    "status" "product_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "price" BIGINT,
    "compare_at_price" BIGINT,
    "status" "variant_status" NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variant_pkey" PRIMARY KEY ("id"),
    -- Giá là VND đã gồm VAT; giá hãng để trống hoặc không thấp hơn giá bán (GLOSSARY "Giá hãng").
    CONSTRAINT "product_variant_price_check" CHECK ("price" IS NULL OR "price" > 0),
    CONSTRAINT "product_variant_compare_at_price_check"
      CHECK ("compare_at_price" IS NULL OR ("price" IS NOT NULL AND "compare_at_price" >= "price"))
);

-- CreateIndex
CREATE UNIQUE INDEX "product_slug_key" ON "product"("slug");

-- CreateIndex
CREATE INDEX "product_product_type_idx" ON "product"("product_type");

-- CreateIndex
CREATE INDEX "product_brand_id_idx" ON "product"("brand_id");

-- CreateIndex
CREATE INDEX "product_category_id_idx" ON "product"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_sku_key" ON "product_variant"("sku");

-- Tổ hợp thuộc tính cấp biến thể là duy nhất trong sản phẩm; JSONB so sánh không phụ thuộc thứ tự key.
CREATE UNIQUE INDEX "product_variant_product_id_attributes_key" ON "product_variant"("product_id", "attributes");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
