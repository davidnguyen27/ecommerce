-- CreateEnum
CREATE TYPE "content_page_kind" AS ENUM ('about', 'process', 'policy');

-- CreateTable
CREATE TABLE "content_page" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "content_page_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_page_version" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_id" UUID NOT NULL,

    CONSTRAINT "content_page_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_page_slug_key" ON "content_page"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "content_page_version_page_id_version_key" ON "content_page_version"("page_id", "version");

-- AddForeignKey
ALTER TABLE "content_page_version" ADD CONSTRAINT "content_page_version_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "content_page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_page_version" ADD CONSTRAINT "content_page_version_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Phiên bản đã xuất bản là bằng chứng nội dung tại thời điểm đó: chỉ thêm mới, không sửa, không xóa.
CREATE FUNCTION "content_page_version_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'content_page_version chỉ cho phép thêm mới';
END;
$$;

CREATE TRIGGER "content_page_version_no_update_delete" BEFORE UPDATE OR DELETE ON "content_page_version"
  FOR EACH ROW EXECUTE FUNCTION "content_page_version_append_only"();

CREATE TRIGGER "content_page_version_no_truncate" BEFORE TRUNCATE ON "content_page_version"
  FOR EACH STATEMENT EXECUTE FUNCTION "content_page_version_append_only"();
