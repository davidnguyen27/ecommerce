-- CreateEnum
CREATE TYPE "commitment_kind" AS ENUM ('warranty', 'other');

-- CreateTable
CREATE TABLE "product_document" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitment_type" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "kind" "commitment_kind" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commitment_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_commitment" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "statement" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_commitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_commitment_document" (
    "commitment_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,

    CONSTRAINT "product_commitment_document_pkey" PRIMARY KEY ("commitment_id","document_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_document_storage_key_key" ON "product_document"("storage_key");

-- CreateIndex
CREATE INDEX "product_document_product_id_idx" ON "product_document"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "commitment_type_name_key" ON "commitment_type"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_commitment_product_id_type_id_key" ON "product_commitment"("product_id", "type_id");

-- CreateIndex
CREATE INDEX "product_commitment_document_document_id_idx" ON "product_commitment_document"("document_id");

-- AddForeignKey
ALTER TABLE "product_document" ADD CONSTRAINT "product_document_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_commitment" ADD CONSTRAINT "product_commitment_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_commitment" ADD CONSTRAINT "product_commitment_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "commitment_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_commitment_document" ADD CONSTRAINT "product_commitment_document_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "product_commitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Chứng từ đang làm bằng chứng cho cam kết thì không xóa được; API báo lỗi kèm danh sách cam kết trước khi tới đây.
-- AddForeignKey
ALTER TABLE "product_commitment_document" ADD CONSTRAINT "product_commitment_document_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "product_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed danh sách loại cam kết. Tên là khóa duy nhất nên chạy lại không tạo trùng, và ON CONFLICT giữ nguyên loại owner đã sửa.
INSERT INTO "commitment_type" ("name", "kind") VALUES
('Bảo hành chính hãng', 'warranty'),
('Bảo hành quốc tế', 'warranty'),
('Có hóa đơn nhập khẩu', 'other')
ON CONFLICT ("name") DO NOTHING;
