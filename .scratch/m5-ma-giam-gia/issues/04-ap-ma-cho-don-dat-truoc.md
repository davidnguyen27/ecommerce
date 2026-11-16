# 04: Áp mã cho đơn đặt trước

**What to build:**
- Khách gõ mã ở trang đặt trước; tiền cọc và phần còn lại tính trên tiền hàng sau giảm, nên phần giảm được chia theo tỷ lệ giữa cọc và phần còn lại (ADR 0012: ưu đãi tính một lần trên đơn). Phần giảm còn nguyên khi khách trả phần còn lại, kể cả khi mã đã hết hạn.

**Blocked by:** 03

**Status:** resolved

- [x] `POST /api/preorders/quote` nhận `voucherCode`, email, số điện thoại (tùy chọn), dùng chung hàm kiểm mã của ticket 03 với hình thức bán `preorder`; trả `voucher`, tiền cọc và phần còn lại tính sau giảm, cùng các giá trị khi không có mã. Cùng bucket giới hạn tần suất
- [x] `POST /api/preorders` nhận `voucherCode` và `discount` khách đã thấy. Sau khi khóa biến thể và dòng đợt như M4: khóa dòng mã `FOR UPDATE`, kiểm lại, tính lại; lệch hoặc không còn dùng được thì 409 như ticket 03
- [x] Tiền cọc = làm tròn lên 1.000 VND của ((`subtotal - discount`) × tỷ lệ / 100). Đổi check thành `0 < deposit_amount <= subtotal - discount`. Link cọc bằng tiền cọc sau giảm; link phần còn lại bằng `total - deposit_amount`
- [x] Email đã nhận cọc, hàng đã về, nhắc trả phần còn lại hiện dòng mã giảm giá khi đơn có mã
- [x] Web khách: trang đặt trước có ô mã giảm giá giống trang đặt mua (dùng lại component), bảng tiền hiện tiền giảm, cọc và phần còn lại sau giảm, hộp thoại 409 như ticket 03. Khối đặt trước ở trang đơn hàng hiện tiền giảm
- [x] Test qua HTTP: tiền cọc tính trên tiền hàng sau giảm và làm tròn lên 1.000; phần còn lại đúng; mã chỉ áp `standard` thì `sale_type`; mã chỉ áp `preorder` thì báo giá đặt mua trả `sale_type`; IPN cọc đúng số sau giảm thì `deposit_paid`; trả phần còn lại sau khi mã hết hạn và bị tắt vẫn đúng số tiền đã chụp

Spec: mục "Mô hình đơn" (đơn đặt trước), "Đặt mua và đặt trước", "Email", "Web".

**Quyết định khi triển khai (2026-11-16):**
- Migration `20261117000300_preorder_deposit_after_discount`: thay `order_preorder_check`, đổi điều kiện tiền cọc thành `deposit_amount <= subtotal - discount`. Các điều kiện khác giữ nguyên.
- `depositFor(subtotal - discount, percent)`: API và trang dùng chung hàm này, nên phần giảm tự chia theo tỷ lệ giữa cọc và phần còn lại. Đơn một dòng nên dòng nhận toàn bộ tiền giảm.
- `api/src/vouchers/apply.ts` thêm `toVoucherQuote(check)` và `requireVoucherAsSeen(check, seenDiscount, totalWithoutVoucher, detailsOf)`. Hàm sau ném 409 với `details` do nơi gọi dựng: đặt mua là `{ lines: [], voucher }`, đặt trước là `{ voucher }`. Route đặt mua (ticket 03) đã chuyển sang dùng hai hàm này. Câu báo lỗi đổi từ "trước khi đặt mua" thành "trước khi đặt" để dùng chung.
- Đặt trước: mã chỉ được kiểm sau khi biến thể, đợt, giá, mức cọc và suất đều đúng, như M4. Khóa dòng mã sau dòng biến thể và dòng suất. Sự kiện đơn `created` ghi thêm `voucherCode` và `discount`.
- Schema shared:
  - `PreorderQuoteRequest` thêm `voucherCode`, `email`, `phone` (dùng chung `QuoteContact` với đặt mua);
  - `PreorderQuote` thêm `voucher`, `discount`, `depositAmountWithoutVoucher`, `totalWithoutVoucher`;
  - `PreorderRequest` thêm `voucherCode`, `discount`;
  - `PreorderConflictDetails` thành union `{ change } | { voucher }`.
- Báo giá đặt trước kèm mã dùng chung bucket `voucher-check:ip` với đặt mua.
- `voucherLines` chuyển sang `orders/format.ts`. Email đã nhận cọc, hàng đã về và nhắc trả phần còn lại có dòng mã giảm giá.
- Web: trang đặt trước dùng lại `VoucherField` và hộp 409 về mã như trang đặt mua. Bảng tiền có dòng giảm, kèm câu "Tiền cọc tính trên tiền hàng sau giảm…". `OrderView` đã có dòng giảm từ ticket 03; tiền cọc và phần còn lại do server tính sau giảm.
- Test `api/test/preorder-voucher.test.ts` (6 test), gồm luồng trọn vẹn: cọc đúng số sau giảm, mã hết hạn rồi bị tắt, hàng về, link phần còn lại đúng 1.353.000, trả xong thì `paid` và vẫn giữ phần giảm. Toàn bộ test API: 54 file, 580 test pass.
- Chưa chạy thử trang đặt trước trên trình duyệt; E2E ở ticket 07.
