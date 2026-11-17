# 02: Mã giảm giá ở trang quản trị

**What to build:**
- Nhân viên bán hàng tạo, sửa, tắt mã giảm giá, và xem danh sách mã kèm số lượt đã dùng. Chưa có đơn nào dùng mã (ticket 03), nhưng cột tham chiếu trên đơn và hàm đếm lượt được làm ở đây để áp quy tắc khóa.

**Blocked by:** —

**Status:** resolved

- [x] Bảng mã giảm giá như spec mục "Mã giảm giá", kèm hai bảng nối phạm vi (thương hiệu, danh mục). Check: `percent` thì giá trị 1–50 và có mức tối đa; `fixed` thì giá trị ≥ 1.000 và không có mức tối đa; đơn tối thiểu ≥ 0; kết thúc sau bắt đầu; tổng lượt ≥ 1 nếu có; lượt mỗi khách ≥ 1. Mã lưu chữ hoa, chỉ gồm chữ và số, dài 4–20, duy nhất
- [x] Thêm cột `order.voucher_id` (nullable, FK, index) ngay ở ticket này, để viết được hàm đếm lượt. Các cột chụp mã và tiền giảm thêm ở ticket 03
- [x] Hàm `usedRedemptions(db, voucherIds)` đếm đơn chưa `cancelled` theo mã, và `customerRedemptions(db, voucherId, email, phone)` đếm theo email (chữ thường) **hoặc** số điện thoại. Test dựng đơn bằng `prisma`
- [x] Trạng thái tính khi đọc: sắp tới, đang chạy, hết hạn, đã tắt. Tắt ghi `disabled_at` và không bật lại được
- [x] Sửa: chưa có lượt dùng thì sửa được mọi trường trừ chuỗi mã; đã có lượt thì chỉ sửa được mô tả, thời điểm kết thúc, tổng lượt (không thấp hơn số đã dùng) và tắt. Vi phạm trả 409. Mã trùng (khác hoa thường) trả 409
- [x] Quyền mới `voucher.manage` (owner, sales) cho thao tác ghi; xem được với `voucher.manage` **hoặc** `order.view`. Mọi thao tác ghi đi qua `audited()`: `voucher.create`, `voucher.update` (trước và sau, chỉ các trường đổi), `voucher.disable`
- [x] API `/api/admin/vouchers`: danh sách (lọc trạng thái, tìm theo mã, `PageQuery`, kèm số lượt đã dùng), chi tiết (kèm phạm vi), tạo, sửa, tắt. Không có endpoint xóa. Schema trong `@ecommerce/shared`
- [x] Web admin: mục "Mã giảm giá" trong `ADMIN_MENU_ITEMS`, danh sách, form tạo/sửa (khóa các trường không sửa được khi đã có lượt dùng, dùng lại bộ chọn thương hiệu và danh mục sẵn có), trang chi tiết, nút tắt kèm hỏi xác nhận
- [x] Test qua HTTP: tạo/sửa/tắt; mã trùng 409; tỷ lệ > 50, thiếu mức tối đa, mã sai định dạng thì 400; sửa trường bị khóa khi đã có lượt 409; giảm tổng lượt dưới số đã dùng 409; thiếu `voucher.manage` 403; `order.view` xem được nhưng không ghi được; audit ghi đủ

Spec: mục "Mã giảm giá", "Quyền", "API quản trị".

**Quyết định khi triển khai (2026-11-16):**
- Migration `20261117000100_vouchers`:
  - enum `voucher_kind`;
  - bảng `voucher`: `amount`/`max_discount`/`min_subtotal` là `BIGINT` VND như các cột tiền của đơn; hình thức bán là cột mảng `sale_types order_kind[]` (dùng lại enum loại đơn) thay vì hai cờ;
  - check: `voucher_code_check` (`^[A-Z0-9]{4,20}$`), `voucher_kind_check` (`fixed` chỉ có `amount >= 1000`; `percent` chỉ có `percent` 1–50 và `max_discount >= 1000`), `voucher_min_subtotal_check`, `voucher_period_check` (`ends_at > starts_at`), `voucher_sale_types_check` (không rỗng), `voucher_limits_check`;
  - bảng nối `voucher_brand`, `voucher_category` (khóa chính kép);
  - `order.voucher_id` (nullable, FK, index). Các cột chụp mã và tiền giảm để ticket 03.
- `api/src/vouchers/vouchers.ts`: `voucherStatus`, `voucherStatusWhere` (cùng một định nghĩa trạng thái), `usedRedemptions(db, ids)` (`groupBy` đơn chưa `cancelled`), `customerRedemptions(db, voucherId, { email, phone })` (email so chữ thường vì đơn lưu email chữ thường; thiếu cả hai thì trả 0), `toVoucher`, `loadVoucher`.
- Route `/api/admin/vouchers` (`admin-vouchers.ts`). Router cần `order.view` **hoặc** `voucher.manage`; ghi cần `voucher.manage`: `GET /` (`status=all|upcoming|active|expired|disabled`, `q` tìm một phần mã, `PageQuery`, mới tạo trước), `GET /:id`, `POST /` (201), `PATCH /:id`, `POST /:id/disable`. Không có endpoint xóa.
- Schema shared `shared/src/vouchers.ts`: `VoucherCreate` (mã chuyển chữ hoa), `VoucherUpdate` (partial, không có `code`), `VoucherDraft` (bản đầy đủ để kiểm ràng buộc giữa các trường sau khi ghép), `VOUCHER_FIELDS_EDITABLE_AFTER_USE`, `Voucher`, `VoucherPage`, `VOUCHER_MAX_PERCENT = 50`.
- Sửa: khóa dòng `voucher` `FOR UPDATE` (ticket 03 khóa cùng dòng khi tạo đơn). So từng trường ở dạng chuẩn (thời điểm ISO, danh sách đã sắp xếp); không đổi gì → 200, không audit. Mã đã tắt → 409. Có lượt dùng mà đổi trường khác mô tả, kết thúc, tổng lượt → 409 kèm `fields` theo từng trường. Tổng lượt < số đã dùng → 409 `totalLimit`. Sau đó ghép vào bản hiện tại và `parse(VoucherDraft)` (ví dụ đổi sang `fixed` mà thiếu `amount` → 400). Phạm vi đổi thì xóa rồi tạo lại dòng nối.
- Mã lỗi: mã trùng (unique) → 409 `code`; thương hiệu/danh mục không tồn tại → 400 `brandIds.<i>`/`categoryIds.<i>`.
- Audit: `voucher.create` (`after` là input đã chuẩn hóa), `voucher.update` (`before`/`after` chỉ các trường đổi, phạm vi là `brandIds`/`categoryIds` đã sắp xếp), `voucher.disable` (`after { disabledAt }`). `entityType` `voucher`. Tắt mã đã tắt → 200 không audit.
- Quyền `voucher.manage` cấp cho sales (owner có mọi quyền). Kho và kế toán xem được nhờ `order.view`.
- Web:
  - `/admin/vouchers` (lọc trạng thái, tìm theo mã, cột đã dùng / tổng lượt);
  - `/admin/vouchers/new`;
  - `/admin/vouchers/[id]` (chi tiết, "Sửa mã", "Tắt mã" kèm hỏi xác nhận).
  Form dùng chung `AdminVoucherForm`: phạm vi chọn bằng danh sách checkbox thương hiệu và danh mục (đọc `/api/admin/brands`, `/api/admin/categories`, tải trong `onMounted` vì form nằm trong `v-if`). Khi mã có lượt dùng thì khóa mọi ô trừ mô tả, kết thúc, tổng lượt và chỉ gửi ba trường đó. Ô giờ chỉ tới phút nên chỉ gửi `startsAt`/`endsAt` khi người dùng đổi. Menu "Mã giảm giá" trong nhóm Bán hàng.
- Danh sách đơn đã dùng mã ở trang chi tiết mã để ticket 06.
- Test `api/test/vouchers-admin.test.ts` (14 test). Gắn mã vào đơn bằng `prisma` vì chưa có đường đặt mua kèm mã; `customerRedemptions` gọi thẳng hàm vì chưa có đường HTTP. Giao diện admin chưa chạy thử trên trình duyệt; E2E ở ticket 07.
