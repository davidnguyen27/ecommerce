# 05: Ghi nhận cọc

**What to build:**
- Khách trả cọc thành công thì đơn đặt trước thành đã cọc (`deposit_paid`) và đang xử lý, khách nhận email xác nhận. Tiền cọc lệch hoặc về muộn thì vào danh sách cần đối soát, và kế toán khôi phục được đơn nếu đợt còn suất. Đơn đã cọc không hủy được.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Trạng thái thanh toán thêm `deposit_paid`. Cạnh của đơn `preorder`: `unpaid` → `deposit_paid` → `paid`; đơn `standard` không đi qua `deposit_paid`
- [ ] Hàm ghi nhận thanh toán: đơn `preorder` đang `pending_payment` và giao dịch `deposit` đúng bằng tiền cọc → `deposit_paid` + `processing`, ghi `deposit_paid_at`, bỏ `reserved_until`, xếp email "đã nhận cọc" (tiền cọc, phần còn lại, thời gian giao dự kiến, link tra cứu). Trường hợp khác vào đối soát với lý do sẵn có. Vẫn chạy nhiều lần cho một kết quả
- [ ] Job hết hạn không hủy đơn đã cọc (truy vấn cổng trước như M3)
- [ ] Khôi phục từ đối soát với đơn `preorder` đã hủy: tiền đúng bằng tiền cọc và đợt còn đủ suất (không cần đợt đang mở) → `deposit_paid`, `deposit_paid_at` = lúc khôi phục; không đủ suất thì 409
- [ ] Hủy đơn `deposit_paid` (khách qua token, tài khoản, nhân viên) đều 409
- [ ] Trang đơn của khách và admin hiện "Đã cọc" khác "Đã trả đủ", cùng phần còn lại
- [ ] Test qua HTTP: IPN đúng tiền → `deposit_paid`, email một lần, IPN lặp chỉ ghi một lần; lệch tiền → đối soát, đơn vẫn chờ cọc; cọc về sau khi hủy → đối soát; khôi phục được và hết suất thì 409; hủy đơn đã cọc 409; đơn đã cọc chưa soạn hàng được (giao hàng cần `paid`)

Spec: mục "Mô hình đơn", "Thanh toán".
