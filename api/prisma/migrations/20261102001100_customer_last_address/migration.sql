-- Địa chỉ nhận hàng của lần đặt mua thành công gần nhất (chỉ một bản), để trang đặt mua tự điền.
-- JSON dạng ShippingAddress: recipientName, phone, email, provinceCode, wardCode, streetAddress.
ALTER TABLE "customer" ADD COLUMN "last_shipping_address" JSONB;
