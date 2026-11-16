-- M5 ticket 03: tiền giảm và mã giảm giá chụp vào đơn.

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "discount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "voucher_amount" BIGINT,
ADD COLUMN     "voucher_code" TEXT,
ADD COLUMN     "voucher_kind" "voucher_kind",
ADD COLUMN     "voucher_max_discount" BIGINT,
ADD COLUMN     "voucher_percent" INTEGER;

-- AlterTable
ALTER TABLE "order_line" ADD COLUMN     "discount" BIGINT NOT NULL DEFAULT 0;


-- Tổng phải trả trừ tiền giảm; đơn cũ có `discount = 0` nên vẫn thỏa.
ALTER TABLE "order" DROP CONSTRAINT "order_money_check";
ALTER TABLE "order" ADD CONSTRAINT "order_money_check" CHECK (
    "subtotal" >= 0 AND "shipping_fee" >= 0 AND "discount" >= 0 AND "discount" <= "subtotal"
    AND "total" = "subtotal" - "discount" + "shipping_fee"
);

-- Có mã thì có đủ giá trị chụp theo đúng loại; không có mã thì không có gì và không giảm.
ALTER TABLE "order" ADD CONSTRAINT "order_voucher_check" CHECK (
    ("voucher_id" IS NULL AND "voucher_code" IS NULL AND "voucher_kind" IS NULL AND "voucher_amount" IS NULL
        AND "voucher_percent" IS NULL AND "voucher_max_discount" IS NULL AND "discount" = 0)
    OR ("voucher_id" IS NOT NULL AND "voucher_code" IS NOT NULL AND (
        ("voucher_kind" = 'fixed' AND "voucher_amount" IS NOT NULL AND "voucher_percent" IS NULL AND "voucher_max_discount" IS NULL)
        OR ("voucher_kind" = 'percent' AND "voucher_amount" IS NULL AND "voucher_percent" IS NOT NULL AND "voucher_max_discount" IS NOT NULL)
    ))
);

ALTER TABLE "order_line" ADD CONSTRAINT "order_line_discount_check" CHECK ("discount" >= 0 AND "discount" <= "price" * "quantity");
