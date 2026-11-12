-- Giữ hàng (ADR 0007): số đã giữ cho đơn, nằm cạnh tồn và không bao giờ vượt tồn. Chỉ module kho ghi.
ALTER TABLE "product_variant" ADD COLUMN "reserved" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_reserved_check" CHECK ("reserved" >= 0 AND "reserved" <= "on_hand");

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending_payment', 'processing', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('unpaid', 'paid');

-- CreateEnum
CREATE TYPE "fulfillment_status" AS ENUM ('not_prepared', 'preparing', 'handed_over', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "order_event_actor" AS ENUM ('staff', 'customer', 'system');

-- Mã đơn khách thấy (#100123), cũng là `orderCode` gửi cổng thanh toán (ADR 0008).
CREATE SEQUENCE "order_code_seq" START WITH 100000;

-- CreateTable
CREATE TABLE "order" (
    "id" UUID NOT NULL,
    "code" INTEGER NOT NULL DEFAULT nextval('order_code_seq'),
    "status" "order_status" NOT NULL DEFAULT 'pending_payment',
    "payment_status" "payment_status" NOT NULL DEFAULT 'unpaid',
    "fulfillment_status" "fulfillment_status" NOT NULL DEFAULT 'not_prepared',
    "customer_id" UUID,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "province_code" TEXT NOT NULL,
    "province_name" TEXT NOT NULL,
    "ward_code" TEXT NOT NULL,
    "ward_name" TEXT NOT NULL,
    "street_address" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "subtotal" BIGINT NOT NULL,
    "shipping_fee" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "lookup_token_hash" TEXT NOT NULL,
    "reserved_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_money_check" CHECK ("subtotal" >= 0 AND "shipping_fee" >= 0 AND "total" = "subtotal" + "shipping_fee")
);

ALTER SEQUENCE "order_code_seq" OWNED BY "order"."code";

-- CreateTable
CREATE TABLE "order_line" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "image" JSONB,
    "price" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "order_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_line_price_check" CHECK ("price" > 0),
    CONSTRAINT "order_line_quantity_check" CHECK ("quantity" BETWEEN 1 AND 5)
);

-- CreateTable
CREATE TABLE "order_policy_version" (
    "order_id" UUID NOT NULL,
    "page_version_id" UUID NOT NULL,

    CONSTRAINT "order_policy_version_pkey" PRIMARY KEY ("order_id", "page_version_id")
);

-- CreateTable
CREATE TABLE "order_event" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" "order_event_actor" NOT NULL,
    "staff_id" UUID,
    "customer_id" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_event_pkey" PRIMARY KEY ("id"),
    -- Sự kiện của nhân viên luôn biết nhân viên nào; khách và hệ thống thì không có nhân viên.
    CONSTRAINT "order_event_staff_check" CHECK (("actor" = 'staff') = ("staff_id" IS NOT NULL)),
    CONSTRAINT "order_event_customer_check" CHECK ("actor" = 'customer' OR "customer_id" IS NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "order_code_key" ON "order"("code");

-- CreateIndex
CREATE UNIQUE INDEX "order_lookup_token_hash_key" ON "order"("lookup_token_hash");

-- CreateIndex
CREATE INDEX "order_customer_id_idx" ON "order"("customer_id");

-- CreateIndex
CREATE INDEX "order_status_reserved_until_idx" ON "order"("status", "reserved_until");

-- CreateIndex
CREATE INDEX "order_created_at_idx" ON "order"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_line_order_id_position_key" ON "order_line"("order_id", "position");

-- CreateIndex
CREATE INDEX "order_line_variant_id_idx" ON "order_line"("variant_id");

-- CreateIndex
CREATE INDEX "order_policy_version_page_version_id_idx" ON "order_policy_version"("page_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_event_seq_key" ON "order_event"("seq");

-- CreateIndex
CREATE INDEX "order_event_order_id_seq_idx" ON "order_event"("order_id", "seq");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_policy_version" ADD CONSTRAINT "order_policy_version_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_policy_version" ADD CONSTRAINT "order_policy_version_page_version_id_fkey" FOREIGN KEY ("page_version_id") REFERENCES "content_page_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lịch sử thao tác của đơn là bằng chứng: chỉ cho thêm mới, như audit log.
CREATE FUNCTION "order_event_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order_event chỉ cho phép thêm mới';
END;
$$;

CREATE TRIGGER "order_event_no_update_delete" BEFORE UPDATE OR DELETE ON "order_event"
  FOR EACH ROW EXECUTE FUNCTION "order_event_append_only"();

CREATE TRIGGER "order_event_no_truncate" BEFORE TRUNCATE ON "order_event"
  FOR EACH STATEMENT EXECUTE FUNCTION "order_event_append_only"();
