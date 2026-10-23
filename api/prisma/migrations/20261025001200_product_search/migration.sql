-- Chuẩn hóa để so khớp: chữ thường, bỏ dấu tiếng Việt. Gọi unaccent với từ điển chỉ rõ để hàm IMMUTABLE dùng được trong index.
CREATE FUNCTION "search_normalize"(input TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, input)) $$;

-- Từ khóa thành truy vấn full-text khớp tiền tố từng từ ("giay da" → giay:* & da:*); không có từ nào thì NULL.
CREATE FUNCTION "search_prefix_query"(input TEXT) RETURNS tsquery
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$
    SELECT to_tsquery('simple', string_agg(word || ':*', ' & '))
    FROM regexp_split_to_table("search_normalize"(input), '[^[:alnum:]]+') AS word
    WHERE word <> ''
  $$;

-- Giá trị của một thuộc tính dưới dạng chữ, để lọc và đếm facets chung cho mọi kiểu (multi_enum là nhiều giá trị).
CREATE FUNCTION "attribute_values"(value JSONB) RETURNS TEXT[]
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$
    SELECT CASE jsonb_typeof(value)
      WHEN 'array' THEN ARRAY(SELECT jsonb_array_elements_text(value))
      WHEN 'null' THEN ARRAY[]::TEXT[]
      ELSE ARRAY[value #>> '{}']
    END
  $$;

-- Dữ liệu tìm kiếm của sản phẩm đang hiện với khách: dựng từ phiên bản đang xuất bản và tên thương hiệu hiện tại.
-- Mỗi sản phẩm đã xuất bản đúng một dòng; trigger bên dưới giữ bảng này khớp, API không ghi vào.
CREATE TABLE "product_search" (
    "product_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    -- Tên sản phẩm, tên thương hiệu, mã mẫu đã chuẩn hóa; dùng cho độ tương đồng trigram.
    "document" TEXT NOT NULL,
    "tsv" tsvector NOT NULL,
    -- Các SKU đang bán, cách nhau và bao quanh bởi dấu cách, để khớp chính xác hoặc tiền tố bằng LIKE.
    "skus" TEXT NOT NULL,

    CONSTRAINT "product_search_pkey" PRIMARY KEY ("product_id")
);

CREATE UNIQUE INDEX "product_search_version_id_key" ON "product_search"("version_id");
CREATE INDEX "product_search_tsv_idx" ON "product_search" USING GIN ("tsv");
CREATE INDEX "product_search_document_idx" ON "product_search" USING GIN ("document" gin_trgm_ops);
CREATE INDEX "product_search_skus_idx" ON "product_search" USING GIN ("skus" gin_trgm_ops);

ALTER TABLE "product_search" ADD CONSTRAINT "product_search_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_search" ADD CONSTRAINT "product_search_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "product_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "refresh_product_search"(target UUID) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "product_search" WHERE "product_id" = target;
  INSERT INTO "product_search" ("product_id", "version_id", "document", "tsv", "skus")
  SELECT p."id", v."id",
    "search_normalize"(concat_ws(' ', v."snapshot"->>'name', b."name", v."snapshot"->>'modelCode')),
    setweight(to_tsvector('simple', "search_normalize"(v."snapshot"->>'name')), 'A')
      || setweight(to_tsvector('simple', "search_normalize"(v."snapshot"->>'modelCode')), 'A')
      || setweight(to_tsvector('simple', "search_normalize"(b."name")), 'B'),
    ' ' || coalesce((SELECT string_agg(variant->>'sku', ' ') FROM jsonb_array_elements(v."snapshot"->'variants') variant), '') || ' '
  FROM "product" p
  JOIN "product_version" v ON v."id" = p."live_version_id"
  JOIN "brand" b ON b."id" = v."brand_id"
  WHERE p."id" = target;
END;
$$;

-- Sản phẩm, biến thể đổi thì khách chỉ thấy khi xuất bản lại (ticket 11), tức khi phiên bản đang xuất bản đổi.
CREATE FUNCTION "product_search_on_product"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "refresh_product_search"(NEW."id");
  RETURN NULL;
END;
$$;

CREATE TRIGGER "product_search_refresh" AFTER INSERT OR UPDATE OF "live_version_id" ON "product"
  FOR EACH ROW EXECUTE FUNCTION "product_search_on_product"();

-- Tên thương hiệu đọc từ chính thương hiệu, nên đổi tên thì làm mới mọi sản phẩm đang hiện của hãng.
CREATE FUNCTION "product_search_on_brand"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "refresh_product_search"(p."id")
  FROM "product" p JOIN "product_version" v ON v."id" = p."live_version_id"
  WHERE v."brand_id" = NEW."id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "product_search_brand_rename" AFTER UPDATE OF "name" ON "brand"
  FOR EACH ROW WHEN (OLD."name" IS DISTINCT FROM NEW."name") EXECUTE FUNCTION "product_search_on_brand"();

SELECT "refresh_product_search"("id") FROM "product" WHERE "live_version_id" IS NOT NULL;
