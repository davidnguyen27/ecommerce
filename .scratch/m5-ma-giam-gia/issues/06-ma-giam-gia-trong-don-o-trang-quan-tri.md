# 06: Mã giảm giá trong đơn ở trang quản trị

**What to build:**
- Nhân viên thấy mã và tiền giảm ở chi tiết đơn, lọc được danh sách đơn theo mã, và xem từ trang chi tiết mã những đơn nào đã dùng nó.

**Blocked by:** 02, 03

**Status:** resolved

- [x] Chi tiết đơn ở API admin trả thêm mã, loại và giá trị lúc đặt, tiền giảm, tiền hàng sau giảm, tiền giảm từng dòng
- [x] Danh sách đơn ở API admin thêm bộ lọc theo mã giảm giá (theo chuỗi mã, không phân biệt hoa thường)
- [x] Chi tiết mã ở API admin thêm danh sách đơn đã dùng (mã đơn, khách, trạng thái, tiền giảm, thời điểm), phân trang `PageQuery`, gồm cả đơn đã hủy nhưng đánh dấu là không tính lượt
- [x] Web admin: khối tiền của chi tiết đơn có dòng mã giảm giá; danh sách đơn có ô lọc theo mã; trang chi tiết mã có bảng đơn đã dùng, mỗi dòng dẫn tới chi tiết đơn. Phiếu soạn hàng không đổi
- [x] Test qua HTTP: chi tiết đơn có đủ trường; lọc theo mã trả đúng đơn; danh sách đơn của mã đúng và đơn hủy được đánh dấu; quyền theo `order.view` như các API đơn hiện có

Spec: mục "API quản trị", "Web" (admin).

**Quyết định khi triển khai (2026-11-16):**
- `OrderLineView` (dùng cho cả khách lẫn admin) thêm `discount` của dòng; khách thấy được tiền giảm từng dòng qua link tra cứu.
- `AdminOrder` thêm `voucher` (`{ id, code, kind, amount, percent, maxDiscount }` chụp lúc đặt, hoặc `null`) và `subtotalAfterDiscount`. Mã và tiền giảm của đơn đã có trong `PublicOrder` từ ticket 03. `kind` khai lại bằng enum tại chỗ, vì `orders.ts` không import `vouchers.ts` (`vouchers.ts` import `orders.ts`).
- `AdminOrderQuery.voucherCode`: lọc theo `order.voucher_code` bằng chuỗi chữ hoa, không dùng join sang bảng `voucher`. Chưa thêm index; số đơn có mã còn nhỏ.
- `GET /api/admin/vouchers/:id/orders` (`PageQuery`, mới đặt trước): mọi đơn có `voucher_id`, kể cả đơn đã hủy, với `counted = status !== 'cancelled'`. Quyền theo router mã giảm giá (`order.view` hoặc `voucher.manage`). Mã không tồn tại thì 404. Schema `VoucherOrder`, `VoucherOrderPage`.
- Web:
  - chi tiết đơn admin: dòng "giảm …" dưới thành tiền của từng dòng có giảm, dòng "Mã giảm giá CODE (mức giảm)" (link sang trang mã khi mở được trang đó) và "Tiền hàng sau giảm";
  - danh sách đơn: ô lọc "Mã giảm giá", nhận cả `?voucherCode=` trên URL (mở với bộ lọc "tất cả");
  - chi tiết mã: bảng "Đơn đã dùng mã" (20 đơn mỗi trang, đơn hủy ghi "Không tính lượt", link sang chi tiết đơn) và link "Lọc ở danh sách đơn". Link sang trang khác lọc theo quyền lấy từ `ADMIN_MENU_ITEMS`.
  Phiếu soạn hàng không đổi.
- Test `api/test/admin-orders-voucher.test.ts` (5 test). Toàn bộ test API: 56 file, 588 test pass.
- Chưa chạy thử các trang admin trên trình duyệt; E2E ở ticket 07.
