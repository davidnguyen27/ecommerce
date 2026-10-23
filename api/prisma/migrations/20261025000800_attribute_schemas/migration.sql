-- CreateTable
CREATE TABLE "attribute_schema" (
    "product_type" "product_type" NOT NULL,
    "attributes" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribute_schema_pkey" PRIMARY KEY ("product_type")
);

-- Seed schema cho năm nhóm hàng theo mục 3.1 của project-overview.md. Khóa chính là nhóm hàng nên
-- chạy lại không tạo trùng, và ON CONFLICT giữ nguyên schema owner đã sửa.
-- Mã mẫu, bảng size, hướng dẫn chọn size/bảo quản là trường chung của sản phẩm (ticket 09), không nằm ở đây;
-- bảo hành chỉ là cam kết có bằng chứng (ADR 0005).
INSERT INTO "attribute_schema" ("product_type", "attributes") VALUES
('footwear', '[
  {"key": "gioi_tinh", "label": "Giới tính", "type": "enum", "options": ["Nam", "Nữ", "Unisex"], "required": true, "level": "product", "filterable": true},
  {"key": "he_size", "label": "Hệ size", "type": "enum", "options": ["EU", "US", "UK", "VN"], "required": true, "level": "product", "filterable": false},
  {"key": "size", "label": "Size", "type": "text", "required": true, "level": "variant", "filterable": true},
  {"key": "mau", "label": "Màu", "type": "text", "required": true, "level": "variant", "filterable": true},
  {"key": "chat_lieu", "label": "Chất liệu", "type": "text", "required": false, "level": "product", "filterable": true}
]'),
('apparel', '[
  {"key": "gioi_tinh", "label": "Giới tính", "type": "enum", "options": ["Nam", "Nữ", "Unisex"], "required": true, "level": "product", "filterable": true},
  {"key": "size", "label": "Size", "type": "text", "required": true, "level": "variant", "filterable": true},
  {"key": "mau", "label": "Màu", "type": "text", "required": true, "level": "variant", "filterable": true},
  {"key": "chat_lieu", "label": "Chất liệu", "type": "text", "required": false, "level": "product", "filterable": true},
  {"key": "phom_dang", "label": "Phom dáng", "type": "enum", "options": ["Slim fit", "Regular fit", "Relaxed fit", "Oversize"], "required": false, "level": "product", "filterable": true}
]'),
('watch', '[
  {"key": "gioi_tinh", "label": "Giới tính", "type": "enum", "options": ["Nam", "Nữ", "Unisex"], "required": true, "level": "product", "filterable": true},
  {"key": "kich_thuoc_mat", "label": "Kích thước mặt", "type": "number", "unit": "mm", "required": true, "level": "product", "filterable": true},
  {"key": "chat_lieu", "label": "Chất liệu", "type": "text", "required": false, "level": "product", "filterable": true},
  {"key": "loai_bo_may", "label": "Loại bộ máy", "type": "enum", "options": ["Quartz", "Automatic", "Cơ lên cót tay", "Năng lượng ánh sáng"], "required": true, "level": "product", "filterable": true}
]'),
('bag', '[
  {"key": "gioi_tinh", "label": "Giới tính", "type": "enum", "options": ["Nam", "Nữ", "Unisex"], "required": true, "level": "product", "filterable": true},
  {"key": "kich_thuoc", "label": "Kích thước", "type": "text", "required": false, "level": "product", "filterable": false},
  {"key": "mau", "label": "Màu", "type": "text", "required": true, "level": "variant", "filterable": true},
  {"key": "chat_lieu", "label": "Chất liệu", "type": "text", "required": false, "level": "product", "filterable": true},
  {"key": "kieu_dang", "label": "Kiểu dáng", "type": "enum", "options": ["Túi xách tay", "Túi đeo vai", "Túi đeo chéo", "Túi tote", "Ba lô", "Ví cầm tay"], "required": false, "level": "product", "filterable": true},
  {"key": "phu_kien_di_kem", "label": "Phụ kiện đi kèm", "type": "text", "required": false, "level": "product", "filterable": false}
]'),
('fragrance', '[
  {"key": "gioi_tinh", "label": "Giới tính", "type": "enum", "options": ["Nam", "Nữ", "Unisex"], "required": true, "level": "product", "filterable": true},
  {"key": "dung_tich", "label": "Dung tích", "type": "number", "unit": "ml", "required": true, "level": "variant", "filterable": true},
  {"key": "nong_do", "label": "Nồng độ", "type": "enum", "options": ["Parfum", "Eau de Parfum", "Eau de Toilette", "Eau de Cologne", "Eau Fraîche"], "required": true, "level": "product", "filterable": true},
  {"key": "nhom_huong", "label": "Nhóm hương", "type": "multi_enum", "options": ["Hương hoa", "Hương gỗ", "Hương cam chanh", "Hương phương Đông", "Hương tươi mát", "Hương trái cây", "Hương thảo mộc", "Hương ngọt"], "required": false, "level": "product", "filterable": true},
  {"key": "dang_dong_goi", "label": "Dạng đóng gói", "type": "enum", "options": ["Fullbox", "Tester", "Mini", "Chiết"], "required": false, "level": "variant", "filterable": true}
]')
ON CONFLICT ("product_type") DO NOTHING;
