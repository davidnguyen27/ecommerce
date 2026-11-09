-- Mã đơn bên cổng thanh toán (ADR 0009): ZaloPay cần `app_trans_id` bắt đầu bằng ngày yymmdd theo GMT+7, khác mã đơn.
-- Cổng trả mã này khi tạo link; truy vấn cổng (refresh=1, job hết hạn) dùng lại. Đơn tạo trước khi có cột thì null.
ALTER TABLE "order" ADD COLUMN "gateway_reference" TEXT;
CREATE UNIQUE INDEX "order_gateway_reference_key" ON "order"("gateway_reference");
