-- CreateTable
CREATE TABLE "product_version" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "product_type" "product_type" NOT NULL,
    "brand_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "from_price" BIGINT NOT NULL,
    "from_compare_at_price" BIGINT,
    "snapshot" JSONB NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_id" UUID NOT NULL,

    CONSTRAINT "product_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_policy_page" (
    "product_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,

    CONSTRAINT "product_policy_page_pkey" PRIMARY KEY ("product_id","page_id")
);

-- AlterTable
ALTER TABLE "product" ADD COLUMN "live_version_id" UUID;

-- Sản phẩm hiện với khách đúng khi nó đã xuất bản, và khi đó luôn có phiên bản để khách đọc.
ALTER TABLE "product" ADD CONSTRAINT "product_live_version_check"
  CHECK (("status" = 'published') = ("live_version_id" IS NOT NULL));

-- CreateIndex
CREATE UNIQUE INDEX "product_live_version_id_key" ON "product"("live_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_version_product_id_version_key" ON "product_version"("product_id", "version");

-- CreateIndex
CREATE INDEX "product_version_slug_idx" ON "product_version"("slug");

-- CreateIndex
CREATE INDEX "product_version_brand_id_idx" ON "product_version"("brand_id");

-- CreateIndex
CREATE INDEX "product_version_category_id_idx" ON "product_version"("category_id");

-- CreateIndex
CREATE INDEX "product_policy_page_page_id_idx" ON "product_policy_page"("page_id");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_live_version_id_fkey" FOREIGN KEY ("live_version_id") REFERENCES "product_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_version" ADD CONSTRAINT "product_version_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_version" ADD CONSTRAINT "product_version_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_version" ADD CONSTRAINT "product_version_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_version" ADD CONSTRAINT "product_version_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_policy_page" ADD CONSTRAINT "product_policy_page_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_policy_page" ADD CONSTRAINT "product_policy_page_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "content_page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phiên bản đã xuất bản là nội dung khách đã thấy tại thời điểm đó: chỉ thêm mới, không sửa, không xóa.
CREATE FUNCTION "product_version_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'product_version chỉ cho phép thêm mới';
END;
$$;

CREATE TRIGGER "product_version_no_update_delete" BEFORE UPDATE OR DELETE ON "product_version"
  FOR EACH ROW EXECUTE FUNCTION "product_version_append_only"();

CREATE TRIGGER "product_version_no_truncate" BEFORE TRUNCATE ON "product_version"
  FOR EACH STATEMENT EXECUTE FUNCTION "product_version_append_only"();
