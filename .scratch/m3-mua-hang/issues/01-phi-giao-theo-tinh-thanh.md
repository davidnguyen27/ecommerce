# 01: Phí giao theo tỉnh/thành

**What to build:**
- Chủ doanh nghiệp cấu hình phí giao ở trang quản trị: một mức mặc định, các mức riêng theo tỉnh/thành, ngưỡng miễn phí giao.
- Có danh mục hành chính mới (34 tỉnh/thành, phường/xã) dùng chung cho API và web.
- Có endpoint báo giá cho trang giỏ và trang đặt mua: nhận giỏ và tỉnh/thành, trả giá từng dòng, phí giao, tổng; không ghi gì.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] `@ecommerce/shared` có danh mục hành chính tĩnh (mã và tên tỉnh/thành, phường/xã theo danh mục áp dụng từ 01/07/2025, không có cấp quận/huyện) và hàm kiểm một cặp tỉnh/thành – phường/xã hợp lệ. Comment đầu file ghi nguồn dữ liệu
- [ ] Bảng cấu hình phí giao: mức mặc định, mức riêng theo mã tỉnh/thành, ngưỡng miễn phí giao (để trống là không miễn phí); VND, số nguyên ≥ 0. Migration SQL viết tay, `schema.prisma` đồng bộ
- [ ] API quản trị đọc và sửa cấu hình phí giao: quyền `price.edit`, đi qua `audited()` với hành động `shipping.fee.update` (before/after). Sửa mà không đổi gì thì không ghi audit, trả 200
- [ ] Hàm tính phí giao thuần: mức riêng của tỉnh thắng mức mặc định; tổng tiền hàng từ ngưỡng trở lên thì phí bằng 0
- [ ] `POST /api/checkout/quote`: nhận giỏ (variant id, số lượng) và mã tỉnh/thành (tùy chọn; thiếu thì không tính phí giao). Trả về:
  - từng dòng: giá hiện tại, còn hàng hay không, ngừng bán hay không;
  - cờ giao đường bộ khi có sản phẩm `ground_shipping_only`;
  - phí giao, tổng tiền hàng, tổng phải trả.

  Chỉ đọc từ snapshot đã xuất bản (CODING_STANDARDS "Dữ liệu công khai").
- [ ] Chưa cấu hình mức mặc định thì `quote` trả 503 "Cửa hàng chưa sẵn sàng nhận đơn"
- [ ] Web lấy danh mục hành chính bằng `GET /api/shipping/regions` hoặc import thẳng từ shared. Chọn một cách, ghi vào quyết định
- [ ] Trang admin "Phí giao" nằm trong nhóm menu phù hợp của `ADMIN_MENU_GROUPS`, khai quyền `price.edit`
- [ ] Có test qua HTTP:
  - mức riêng thắng mặc định;
  - đạt ngưỡng thì miễn phí;
  - chưa có mức mặc định thì 503;
  - thiếu `price.edit` thì 403;
  - sửa cấu hình ghi audit;
  - mã tỉnh/thành sai bị từ chối theo trường

**Quyết định cần ghi khi triển khai:** phí giao dùng quyền `price.edit` có sẵn, vì phí giao là một loại giá khách trả (spec "Phí giao").
