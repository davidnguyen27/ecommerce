# 10: Đơn đặt trước ở trang quản trị và "Đặt trước cần xử lý"

**What to build:**
- Nhân viên lọc đơn theo loại và theo đợt, xem chi tiết đợt kèm danh sách đơn theo thứ tự cọc, và có danh sách "Đặt trước cần xử lý" gồm đơn quá hạn trả phần còn lại và đợt gặp sự cố có đơn đã cọc. Dashboard hiện số mục cần xử lý.

**Blocked by:** 08, 09

**Status:** ready-for-agent

- [ ] Danh sách đơn thêm bộ lọc: loại đơn, đợt, "quá hạn trả phần còn lại"
- [ ] Chi tiết đợt: từng biến thể có suất, đã cọc, chờ cọc, đã về; danh sách đơn theo `deposit_paid_at`, kèm trạng thái và số đã về
- [ ] Chi tiết đơn: khối đặt trước (đợt, tiền cọc, phần còn lại, số đã về, hạn trả, quá hạn) và giao dịch theo mục đích
- [ ] `GET` "Đặt trước cần xử lý" (`order.view`): đơn quá hạn và đợt `issue` có đơn `deposit_paid`. Trang admin tương ứng
- [ ] Dashboard: số mục cần xử lý, hiện theo quyền
- [ ] Test qua HTTP: các bộ lọc; số liệu của chi tiết đợt khớp với đơn dựng sẵn; danh sách cần xử lý có và không có đúng các mục; 403 khi thiếu `order.view`

Spec: mục "API quản trị", "Web".
