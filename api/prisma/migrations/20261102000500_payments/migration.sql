-- CreateEnum
CREATE TYPE "payment_source" AS ENUM ('webhook', 'query', 'simulator');

-- CreateEnum
CREATE TYPE "reconciliation_reason" AS ENUM ('amount_mismatch', 'paid_after_cancel', 'extra_payment');

-- CreateEnum
CREATE TYPE "reconciliation_status" AS ENUM ('open', 'resolved');

-- Mỗi khoản tiền cổng báo về cho đơn (ADR 0008). Mã tham chiếu unique để webhook và truy vấn không ghi một khoản hai lần.
CREATE TABLE "payment_transaction" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "reference" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "source" "payment_source" NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_transaction_amount_check" CHECK ("amount" > 0)
);

-- Khoản tiền không khớp với đơn, chờ kế toán quyết định; hệ thống không tự xử lý.
CREATE TABLE "reconciliation_item" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "reason" "reconciliation_reason" NOT NULL,
    "amount" BIGINT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "status" "reconciliation_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_item_pkey" PRIMARY KEY ("id")
);

-- Token tra cứu cấp thêm cho link trong email; token lúc đặt mua vẫn nằm ở "order"."lookup_token_hash".
CREATE TABLE "order_lookup_token" (
    "token_hash" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_lookup_token_pkey" PRIMARY KEY ("token_hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_transaction_reference_key" ON "payment_transaction"("reference");

-- CreateIndex
CREATE INDEX "payment_transaction_order_id_idx" ON "payment_transaction"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_item_transaction_id_key" ON "reconciliation_item"("transaction_id");

-- CreateIndex
CREATE INDEX "reconciliation_item_order_id_idx" ON "reconciliation_item"("order_id");

-- CreateIndex
CREATE INDEX "reconciliation_item_status_created_at_idx" ON "reconciliation_item"("status", "created_at");

-- CreateIndex
CREATE INDEX "order_lookup_token_order_id_idx" ON "order_lookup_token"("order_id");

-- AddForeignKey
ALTER TABLE "payment_transaction" ADD CONSTRAINT "payment_transaction_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_item" ADD CONSTRAINT "reconciliation_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_item" ADD CONSTRAINT "reconciliation_item_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "payment_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lookup_token" ADD CONSTRAINT "order_lookup_token_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tiền đã về là bằng chứng: chỉ cho thêm mới, như sự kiện đơn.
CREATE FUNCTION "payment_transaction_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment_transaction chỉ cho phép thêm mới';
END;
$$;

CREATE TRIGGER "payment_transaction_no_update_delete" BEFORE UPDATE OR DELETE ON "payment_transaction"
  FOR EACH ROW EXECUTE FUNCTION "payment_transaction_append_only"();

CREATE TRIGGER "payment_transaction_no_truncate" BEFORE TRUNCATE ON "payment_transaction"
  FOR EACH STATEMENT EXECUTE FUNCTION "payment_transaction_append_only"();
