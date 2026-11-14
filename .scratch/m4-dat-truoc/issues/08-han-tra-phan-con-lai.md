# 08: Nhắc và quá hạn trả phần còn lại

**What to build:**
- Hai ngày trước hạn trả phần còn lại, khách nhận email nhắc. Quá hạn thì đơn bị gắn cờ "Quá hạn trả phần còn lại" nhưng vẫn giữ hàng và vẫn trả được; không tự hủy, không mất cọc (M6).

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] Đơn có thời điểm đã nhắc và `remainder_overdue_at`
- [ ] Job pg-boss định kỳ mỗi giờ: nhắc đơn `deposit_paid` đã về hàng, chưa nhắc, còn ≤ 2 ngày; gắn cờ đơn quá `remainder_due_at` vẫn `deposit_paid`, ghi sự kiện đơn. Chạy nhiều lần cho một kết quả
- [ ] Trả phần còn lại sau khi quá hạn vẫn được (ticket 07 xóa cờ)
- [ ] Trang đơn của khách hiện hạn trả và trạng thái quá hạn
- [ ] Test (gọi thẳng hàm job với `now` ở tương lai, kiểm qua HTTP): nhắc đúng một lần trong cửa sổ, không nhắc đơn chưa về hàng hoặc đã `paid`; quá hạn gắn cờ, không hủy, hàng vẫn giữ; trả sau quá hạn thì `paid` và hết cờ; chạy lại không gửi thêm, không ghi thêm sự kiện

Spec: mục "Hạn trả phần còn lại".
