# 04: Áp mã cho đơn đặt trước

**What to build:**
- Khách gõ mã ở trang đặt trước; tiền cọc và phần còn lại tính trên tiền hàng sau giảm, nên phần giảm được chia theo tỷ lệ giữa cọc và phần còn lại (ADR 0012: ưu đãi tính một lần trên đơn). Phần giảm còn nguyên khi khách trả phần còn lại, kể cả khi mã đã hết hạn.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `POST /api/preorders/quote` nhận `voucherCode`, email, số điện thoại (tùy chọn), dùng chung hàm kiểm mã của ticket 03 với hình thức bán `preorder`; trả `voucher`, tiền cọc và phần còn lại tính sau giảm, cùng các giá trị khi không có mã. Cùng bucket giới hạn tần suất
- [ ] `POST /api/preorders` nhận `voucherCode` và `discount` khách đã thấy. Sau khi khóa biến thể và dòng đợt như M4: khóa dòng mã `FOR UPDATE`, kiểm lại, tính lại; lệch hoặc không còn dùng được thì 409 như ticket 03
- [ ] Tiền cọc = làm tròn lên 1.000 VND của ((`subtotal - discount`) × tỷ lệ / 100). Đổi check thành `0 < deposit_amount <= subtotal - discount`. Link cọc bằng tiền cọc sau giảm; link phần còn lại bằng `total - deposit_amount`
- [ ] Email đã nhận cọc, hàng đã về, nhắc trả phần còn lại hiện dòng mã giảm giá khi đơn có mã
- [ ] Web khách: trang đặt trước có ô mã giảm giá giống trang đặt mua (dùng lại component), bảng tiền hiện tiền giảm, cọc và phần còn lại sau giảm, hộp thoại 409 như ticket 03. Khối đặt trước ở trang đơn hàng hiện tiền giảm
- [ ] Test qua HTTP: tiền cọc tính trên tiền hàng sau giảm và làm tròn lên 1.000; phần còn lại đúng; mã chỉ áp `standard` thì `sale_type`; mã chỉ áp `preorder` thì báo giá đặt mua trả `sale_type`; IPN cọc đúng số sau giảm thì `deposit_paid`; trả phần còn lại sau khi mã hết hạn và bị tắt vẫn đúng số tiền đã chụp

Spec: mục "Mô hình đơn" (đơn đặt trước), "Đặt mua và đặt trước", "Email", "Web".
