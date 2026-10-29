-- CreateTable
CREATE TABLE "stock_receipt" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "received_on" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_receipt_seq_key" ON "stock_receipt"("seq");

-- AddForeignKey
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Dòng phiếu là các dòng sổ loại nhập kho trỏ về phiếu; chỉ loại đó có phiếu, và luôn có.
ALTER TABLE "stock_movement" ADD COLUMN "receipt_id" UUID;
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_receipt_check" CHECK (("kind" = 'receipt') = ("receipt_id" IS NOT NULL));
CREATE INDEX "stock_movement_receipt_id_idx" ON "stock_movement"("receipt_id");
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "stock_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phiếu nhập không sửa, không xóa; nhập sai thì làm điều chỉnh.
CREATE FUNCTION "stock_receipt_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_receipt chỉ cho phép thêm mới';
END;
$$;

CREATE TRIGGER "stock_receipt_no_update_delete" BEFORE UPDATE OR DELETE ON "stock_receipt"
  FOR EACH ROW EXECUTE FUNCTION "stock_receipt_append_only"();

CREATE TRIGGER "stock_receipt_no_truncate" BEFORE TRUNCATE ON "stock_receipt"
  FOR EACH STATEMENT EXECUTE FUNCTION "stock_receipt_append_only"();
