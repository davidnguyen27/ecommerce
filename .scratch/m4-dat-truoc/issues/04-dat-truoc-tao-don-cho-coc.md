# 04: Đặt trước tạo đơn chờ cọc

**What to build:**
- Khách bấm "Đặt trước", chọn 1–5 cái, nhập thông tin nhận hàng, xem bảng tiền (tiền hàng, phí giao, tổng, tiền cọc, phần còn lại), thời gian giao dự kiến, hạn trả phần còn lại, đồng ý chính sách đặt trước, rồi được chuyển tới VNPAY để trả cọc. Đơn chờ cọc chiếm suất trong 15 phút. Quá hạn thì tự hủy, và khách tự hủy được khi chưa cọc.

**Blocked by:** 01, 03

**Status:** ready-for-agent

- [ ] Chính sách đặt trước là một trang chính sách có slug cố định (như chính sách bảo mật). Chưa có phiên bản xuất bản thì `quote` và `preorders` trả 503
- [ ] Đơn có loại (`standard`, `preorder`). Đơn `preorder` có một dòng đơn, tham chiếu đợt, và chụp lại tỷ lệ cọc, tiền cọc, thời gian giao dự kiến, số ngày trả phần còn lại, phiên bản chính sách đặt trước. Tiền cọc = làm tròn lên 1.000 của tiền hàng × tỷ lệ / 100. Check `0 < deposit_amount <= subtotal`
- [ ] `POST /api/preorders/quote` và `POST /api/preorders` theo spec mục "Đặt trước": khóa biến thể và dòng biến thể của đợt `FOR UPDATE`; kiểm đang nhận đặt trước, giá, tỷ lệ cọc, đợt; có hàng sẵn thì 409 `in_stock`; các thay đổi khác cũng 409 kèm `details`, không ghi gì; không đụng `reserved`; tạo link `deposit` với hạn 15 phút
- [ ] Đồng ý chính sách bảo mật (khách vãng lai) và đồng ý chính sách đặt trước (mọi khách) là bắt buộc. Giới hạn tần suất và số đơn đang chờ dùng chung bộ đếm với `POST /api/checkout`
- [ ] Hết hạn và hủy chưa cọc (token, tài khoản, nhân viên) dùng lại M3. Đơn `preorder` không có hàng giữ nên không nhả gì; suất tự trống ra
- [ ] Web: trang `/dat-truoc/<variantId>` (`noindex`) như spec mục "Web". Trang kết quả thanh toán dùng lại M3. Trang đơn hàng hiện khối đặt trước (tiền cọc, còn lại, thời gian giao dự kiến). `scripts/smoke.ts` thêm trang này
- [ ] Test qua HTTP: tạo đơn và link đúng tiền cọc (có ca làm tròn); `reserved` không đổi; mỗi lý do 409 không ghi gì; thiếu đồng ý chính sách đặt trước bị từ chối; 503 khi chưa có chính sách; nhiều khách tranh suất cuối song song thì đúng một đơn; hết hạn thì hủy và trống suất; khách hủy chưa cọc

Spec: mục "Mô hình đơn", "Đặt trước", ADR 0012.
