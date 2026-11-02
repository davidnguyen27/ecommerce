# 01: Phí giao theo tỉnh/thành

**What to build:**
- Chủ doanh nghiệp cấu hình phí giao ở trang quản trị: một mức mặc định, các mức riêng theo tỉnh/thành, ngưỡng miễn phí giao.
- Có danh mục hành chính mới (34 tỉnh/thành, phường/xã) dùng chung cho API và web.
- Có endpoint báo giá cho trang giỏ và trang đặt mua: nhận giỏ và tỉnh/thành, trả giá từng dòng, phí giao, tổng; không ghi gì.

**Blocked by:** —

**Status:** resolved

- [x] `@ecommerce/shared` có danh mục hành chính tĩnh (mã và tên tỉnh/thành, phường/xã theo danh mục áp dụng từ 01/07/2025, không có cấp quận/huyện) và hàm kiểm một cặp tỉnh/thành – phường/xã hợp lệ. Comment đầu file ghi nguồn dữ liệu
- [x] Bảng cấu hình phí giao: mức mặc định, mức riêng theo mã tỉnh/thành, ngưỡng miễn phí giao (để trống là không miễn phí); VND, số nguyên ≥ 0. Migration SQL viết tay, `schema.prisma` đồng bộ
- [x] API quản trị đọc và sửa cấu hình phí giao: quyền `price.edit`, đi qua `audited()` với hành động `shipping.fee.update` (before/after). Sửa mà không đổi gì thì không ghi audit, trả 200
- [x] Hàm tính phí giao thuần: mức riêng của tỉnh thắng mức mặc định; tổng tiền hàng từ ngưỡng trở lên thì phí bằng 0
- [x] `POST /api/checkout/quote`: nhận giỏ (variant id, số lượng) và mã tỉnh/thành (tùy chọn; thiếu thì không tính phí giao). Trả về:
  - từng dòng: giá hiện tại, còn hàng hay không, ngừng bán hay không;
  - cờ giao đường bộ khi có sản phẩm `ground_shipping_only`;
  - phí giao, tổng tiền hàng, tổng phải trả.

  Chỉ đọc từ snapshot đã xuất bản (CODING_STANDARDS "Dữ liệu công khai").
- [x] Chưa cấu hình mức mặc định thì `quote` trả 503 "Cửa hàng chưa sẵn sàng nhận đơn"
- [x] Web lấy danh mục hành chính bằng `GET /api/shipping/regions` hoặc import thẳng từ shared. Chọn một cách, ghi vào quyết định
- [x] Trang admin "Phí giao" nằm trong nhóm menu phù hợp của `ADMIN_MENU_GROUPS`, khai quyền `price.edit`
- [x] Có test qua HTTP:
  - mức riêng thắng mặc định;
  - đạt ngưỡng thì miễn phí;
  - chưa có mức mặc định thì 503;
  - thiếu `price.edit` thì 403;
  - sửa cấu hình ghi audit;
  - mã tỉnh/thành sai bị từ chối theo trường

**Quyết định cần ghi khi triển khai:** phí giao dùng quyền `price.edit` có sẵn, vì phí giao là một loại giá khách trả (spec "Phí giao").

**Quyết định khi triển khai (2026-11-02):**
- Quyền: phí giao dùng `price.edit` có sẵn (đọc và sửa), vì phí giao là một loại giá khách trả. Không thêm quyền mới.
- Nguồn danh mục hành chính: bộ dữ liệu mở `thanglequoc/vietnamese-provinces-database` (MIT), file `json/full_json_generated_data_vn_units.json` ở commit `15723a576946472d44ed3e81f2b89f652fd76885` (bản v5.2.0, sinh ngày 20/09/2026), dựng từ danh mục mã đơn vị hành chính của Cục Thống kê. 34 tỉnh/thành, 3321 phường/xã/đặc khu, mã tỉnh 2 chữ số, mã phường/xã 5 chữ số. Bộ này đã cập nhật đến nghị quyết 388/NQ-UBTVQH16, nên có các thay đổi sau 01/07/2025 (ví dụ Quảng Ninh, Bắc Ninh, Đồng Nai thành thành phố).
- Script sinh: `scripts/generate-regions.ts` (`pnpm generate-regions <file json> <commit>`, rồi chạy Prettier). Comment đầu script ghi lệnh tải file. Script sinh hai file `shared/src/provinces.generated.ts` và `shared/src/wards.generated.ts`; comment đầu mỗi file ghi nguồn và commit.
- Tách gói: tỉnh/thành nằm trong export chính (`PROVINCES`, schema `ProvinceCode`, `provinceName`). Phường/xã (khoảng 120 KB) nằm ở entry riêng `@ecommerce/shared/wards` (`wardsOf`, `wardName`, `isValidWard`), để các trang không nạp chúng. Ticket 03: web import động `await import('@ecommerce/shared/wards')` ở trang đặt mua; API import thẳng để kiểm cặp tỉnh/thành – phường/xã.
- Web dùng danh mục bằng cách import thẳng từ shared. Không có `GET /api/shipping/regions`.
- Bảng: `shipping_fee_setting` có tối đa một dòng (check `id`), gồm `default_fee` và `free_shipping_threshold` (có thể null). Không có dòng nghĩa là chưa cấu hình. Bảng `shipping_fee_province` (khóa `province_code`, có `fee`). Đều là INTEGER, check `>= 0`. Migration `20261102000100_shipping_fees`.
- API quản trị: `GET` và `PUT /api/admin/shipping-fees`. `PUT` thay toàn bộ cấu hình (`ShippingFeeConfigRequest`: `defaultFee` bắt buộc, `freeShippingThreshold` có thể null, `provinceFees[]` không lặp tỉnh). Lệnh ghi khóa bằng `pg_advisory_xact_lock`. Audit dùng `shipping.fee.update` với `entityType`/`entityId` là `shipping_fee`, before/after là `ShippingFeeConfig`. Sửa mà không đổi gì thì trả 200 và không ghi.
- Tên dùng chung cho ticket 02/03, đặt trong shared:
  - `CartLine` (`variantId`, `quantity` 1–5) và `CartLines` (1–50 dòng, mỗi biến thể một dòng; dòng lặp bị từ chối theo trường), cùng `MAX_QUANTITY_PER_VARIANT = 5` và `MAX_CART_LINES`;
  - `CheckoutQuoteRequest` (`lines`, `provinceCode` tùy chọn) và `CheckoutQuote` (`lines: QuoteLine[]`, `groundShippingOnly`, `subtotal`, `freeShippingThreshold`, `shippingFee`, `total`);
  - `ShippingFeeConfig`, `ShippingFeeConfigRequest`, hàm thuần `shippingFeeFor(config, provinceCode, subtotal)`.
- Phía API, ticket 03 dùng lại:
  - `requireShippingFeeConfig(db)` (ném 503 "Cửa hàng chưa sẵn sàng nhận đơn") và `readShippingFeeConfig` trong `api/src/shipping/shipping-fees.ts`;
  - `cartVariants(db, ids)` trong `api/src/checkout/live-variants.ts`, đọc biến thể từ phiên bản đang xuất bản;
  - router `checkoutRoutes(prisma, storage)` trong `api/src/routes/checkout.ts`, gắn ở `/api/checkout`. Ticket 03 thêm `POST /` vào router này.
- Mỗi `QuoteLine` có:
  - `variantId`, `quantity`;
  - `product {slug,name}`: null khi sản phẩm không còn xuất bản;
  - `sku`, `attributes`, `image` (ảnh của biến thể, không có thì ảnh đầu);
  - `price`, `compareAtPrice`, `lineTotal`;
  - `discontinued`, `inStock`.

  Dòng ngừng bán có `discontinued: true` và giá null. Dòng bị coi là ngừng bán khi: biến thể không có trong snapshot đang xuất bản, sản phẩm thôi xuất bản, id không tồn tại, hoặc biến thể đang ở trạng thái `discontinued` dù chưa xuất bản lại. Trường hợp cuối là chỗ duy nhất đọc ngoài snapshot, ngoài tồn kho, theo spec "kiểm từng dòng: … không ngừng bán". Response không có giá khách đã thấy: trang giỏ so với giá lưu ở localStorage để báo dòng đổi giá.
- `subtotal` chỉ cộng các dòng mua được (còn bán và còn hàng). Ngưỡng miễn phí so với `subtotal` này. Không gửi `provinceCode` (trang giỏ) thì `shippingFee` và `total` là null. Chưa có mức mặc định thì `quote` trả 503 kể cả khi không gửi tỉnh.
- `groundShippingOnly` bật khi có ít nhất một dòng mua được thuộc sản phẩm chỉ giao đường bộ.
- `PublicImage` trong `shared/src/products.ts` giờ được export để dùng trong `QuoteLine`.
- Ticket 02 cần thêm `id` của biến thể vào `PublicProduct.variants`, vì trang sản phẩm hiện chỉ trả `sku` mà giỏ lưu theo variant id. Ticket này không làm phần đó.
- Trang admin `/admin/shipping-fees` ("Phí giao") nằm trong nhóm menu mới "Bán hàng" của `ADMIN_MENU_GROUPS`, quyền `price.edit`. Các ticket 07 và 10 thêm "Đơn hàng" và "Cần đối soát" vào nhóm này. Nhãn audit đã thêm vào `auditLabels.ts`. Chưa xem trang bằng mắt trong app đang chạy.
- Hàm `shippingFeeFor` chỉ được test qua HTTP, vì shared chưa có bộ chạy test.
