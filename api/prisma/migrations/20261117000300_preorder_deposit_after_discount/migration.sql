-- M5 ticket 04: tiền cọc tính trên tiền hàng sau giảm giá, nên không vượt `subtotal - discount` (thay vì `subtotal`).
ALTER TABLE "order" DROP CONSTRAINT "order_preorder_check";
ALTER TABLE "order" ADD CONSTRAINT "order_preorder_check" CHECK (
  (
    "kind" = 'standard'
    AND "preorder_campaign_id" IS NULL AND "deposit_percent" IS NULL AND "deposit_amount" IS NULL
    AND "delivery_from" IS NULL AND "delivery_to" IS NULL AND "remainder_days" IS NULL
  ) OR (
    "kind" = 'preorder'
    AND "preorder_campaign_id" IS NOT NULL
    AND "deposit_percent" BETWEEN 10 AND 100
    AND "deposit_amount" > 0 AND "deposit_amount" <= "subtotal" - "discount"
    AND "delivery_from" IS NOT NULL AND "delivery_to" IS NOT NULL AND "delivery_from" <= "delivery_to"
    AND "remainder_days" >= 1
  )
);
