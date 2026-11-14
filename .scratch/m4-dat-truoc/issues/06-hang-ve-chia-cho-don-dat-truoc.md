# 06: Hàng về được chia cho đơn đặt trước

**What to build:**
- Khi kho ghi phiếu nhập, hàng của từng biến thể được giữ ngay cho các đơn đặt trước đã cọc đang chờ, theo thứ tự cọc, từng cái một; phần dư mới thành hàng sẵn. Đơn được giữ đủ hàng thì thành "hàng đã về", có hạn trả phần còn lại, và khách nhận email. Kho xem trước được kết quả chia trước khi ghi.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Dòng đơn có `reserved_quantity` (0 ≤ x ≤ quantity). Với đơn `standard`, giá trị này bằng `quantity` khi giữ hàng (migration điền cho đơn cũ đang giữ). Đơn `preorder` có `arrived_at`, `remainder_due_at`
- [ ] Ghi phiếu nhập (mọi phiếu, không gắn đợt): trong cùng transaction, qua module kho, sau khi cộng `on_hand` thì chia theo spec mục "Hàng về". Các dòng được sắp theo `deposit_paid_at` rồi mã đơn; mỗi dòng cộng `reserved_quantity` và `reserved` của biến thể. Đơn chờ cọc không được chia
- [ ] Dòng vừa được giữ đủ → `arrived_at` = bây giờ, `remainder_due_at` = `arrived_at` + số ngày đã chụp, sự kiện đơn (actor: hệ thống), email "Hàng đã về" (phần còn lại, hạn trả, link trang đơn)
- [ ] Điều chỉnh tồn và tồn đầu kỳ không chia hàng. Điều chỉnh xuống dưới `reserved` thì 409, kèm cả mã đơn đặt trước đang giữ
- [ ] Xem trước: với các dòng định nhập, trả số sẽ giữ cho đơn đặt trước, số đơn liên quan, số thành hàng sẵn; không ghi gì. Form phiếu nhập ở admin hiện phần này trước khi xác nhận
- [ ] Trang đơn (khách và admin) hiện số đã về / số lượng và hạn trả
- [ ] Test qua HTTP: A(2) B(3) C(1) nhập 4 → A đủ, B 2/3, C 0, không có hàng sẵn mới; nhập tiếp 2 → B đủ, C đủ; nhập dư → phần dư thành `in_stock`; đơn chờ cọc bị bỏ qua; preview khớp kết quả thật; email một lần cho mỗi đơn đủ hàng; điều chỉnh không chia; 409 điều chỉnh liệt kê đơn đặt trước

Spec: mục "Hàng về", ADR 0013.
