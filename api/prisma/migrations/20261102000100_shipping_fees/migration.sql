-- Cấu hình phí giao chung: đúng một dòng. Chưa có dòng nào là chưa cấu hình mức mặc định, cửa hàng chưa nhận đơn.
CREATE TABLE "shipping_fee_setting" (
    "id" BOOLEAN NOT NULL DEFAULT true,
    "default_fee" INTEGER NOT NULL,
    "free_shipping_threshold" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_fee_setting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipping_fee_setting_singleton_check" CHECK ("id"),
    CONSTRAINT "shipping_fee_setting_default_fee_check" CHECK ("default_fee" >= 0),
    CONSTRAINT "shipping_fee_setting_free_shipping_threshold_check" CHECK ("free_shipping_threshold" >= 0)
);

-- Mức riêng theo tỉnh/thành; mã theo danh mục hành chính tĩnh trong @ecommerce/shared (API kiểm trước khi ghi).
CREATE TABLE "shipping_fee_province" (
    "province_code" TEXT NOT NULL,
    "fee" INTEGER NOT NULL,

    CONSTRAINT "shipping_fee_province_pkey" PRIMARY KEY ("province_code"),
    CONSTRAINT "shipping_fee_province_fee_check" CHECK ("fee" >= 0)
);
