-- Logo thương hiệu trên bucket public: `StoredImage` (key, contentType, width, height, widths); `null` khi chưa có.
ALTER TABLE "brand" ADD COLUMN "logo" JSONB;

-- CreateTable
CREATE TABLE "product_image" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "widths" INTEGER[],
    "alt" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_image_variant" (
    "image_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,

    CONSTRAINT "product_image_variant_pkey" PRIMARY KEY ("image_id","variant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_image_storage_key_key" ON "product_image"("storage_key");

-- CreateIndex
CREATE INDEX "product_image_product_id_idx" ON "product_image"("product_id");

-- CreateIndex
CREATE INDEX "product_image_variant_variant_id_idx" ON "product_image_variant"("variant_id");

-- AddForeignKey
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image_variant" ADD CONSTRAINT "product_image_variant_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "product_image"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image_variant" ADD CONSTRAINT "product_image_variant_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
