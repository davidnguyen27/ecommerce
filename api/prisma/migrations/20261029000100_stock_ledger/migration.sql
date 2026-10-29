-- Tồn của biến thể trong kho duy nhất; chỉ module kho ghi, luôn kèm một dòng sổ xuất nhập trong cùng transaction.
ALTER TABLE "product_variant" ADD COLUMN "on_hand" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_on_hand_check" CHECK ("on_hand" >= 0);

-- CreateEnum
CREATE TYPE "stock_movement_kind" AS ENUM ('receipt', 'adjustment', 'opening');

-- CreateEnum
CREATE TYPE "stock_adjustment_reason" AS ENUM ('stocktake', 'damaged', 'lost', 'other');

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "variant_id" UUID NOT NULL,
    "kind" "stock_movement_kind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "on_hand_after" INTEGER NOT NULL,
    "reason" "stock_adjustment_reason",
    "note" TEXT NOT NULL DEFAULT '',
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_movement_quantity_check" CHECK ("quantity" <> 0),
    CONSTRAINT "stock_movement_on_hand_after_check" CHECK ("on_hand_after" >= 0),
    -- Lý do chỉ có ở điều chỉnh, và điều chỉnh luôn có lý do.
    CONSTRAINT "stock_movement_reason_check" CHECK (("kind" = 'adjustment') = ("reason" IS NOT NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_seq_key" ON "stock_movement"("seq");

-- CreateIndex
CREATE INDEX "stock_movement_variant_id_seq_idx" ON "stock_movement"("variant_id", "seq");

-- CreateIndex
CREATE INDEX "stock_movement_created_at_idx" ON "stock_movement"("created_at");

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sổ xuất nhập là bằng chứng đối chiếu tồn: chỉ cho thêm mới, như audit log.
CREATE FUNCTION "stock_movement_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movement chỉ cho phép thêm mới';
END;
$$;

CREATE TRIGGER "stock_movement_no_update_delete" BEFORE UPDATE OR DELETE ON "stock_movement"
  FOR EACH ROW EXECUTE FUNCTION "stock_movement_append_only"();

CREATE TRIGGER "stock_movement_no_truncate" BEFORE TRUNCATE ON "stock_movement"
  FOR EACH STATEMENT EXECUTE FUNCTION "stock_movement_append_only"();
