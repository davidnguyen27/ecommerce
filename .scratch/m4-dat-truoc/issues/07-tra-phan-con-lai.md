# 07: Trả phần còn lại

**What to build:**
- Đơn đặt trước đã về hàng có nút "Trả phần còn lại" trên trang đơn (qua token và trong tài khoản). Khách trả qua VNPAY; thành công thì đơn đã trả đủ và vào danh sách cần soạn như đơn hàng sẵn. Trả không thành công thì thử lại được, đơn không bị hủy.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] `POST /api/orders/:code/pay-remainder?token=…` và `POST /api/account/orders/:code/pay-remainder`: chỉ khi đơn `deposit_paid` và đã về hàng, ngoài ra 409. Mỗi lần gọi tạo một link `remainder` mới, số tiền bằng phần còn lại, hạn 15 phút. Link hết hạn không đổi đơn
- [ ] Hàm ghi nhận: giao dịch `remainder` đúng bằng phần còn lại cho đơn `deposit_paid` đã về hàng → `paid`, xóa cờ quá hạn nếu có, email "đã nhận thanh toán" của M3. Trả khi hàng chưa về hay khi đã `paid` → đối soát (`extra_payment`); lệch tiền → `amount_mismatch`
- [ ] Giới hạn tần suất cho `pay-remainder` theo IP (dùng `enforceRateLimits`)
- [ ] Soạn, bàn giao, giao của đơn `preorder` đã `paid` dùng lại M3 (trừ `on_hand` và `reserved`, ghi sổ `sale`)
- [ ] Web: nút trên `OrderView`, trang kết quả dùng lại M3
- [ ] Test qua HTTP: trước khi về hàng 409; link đúng số tiền; trả thành công → `paid` và soạn được; trả hai lần → đối soát; lệch tiền → đối soát; link hết hạn không đổi đơn; bàn giao đơn đặt trước trừ đúng tồn và đang giữ

Spec: mục "Thanh toán".
