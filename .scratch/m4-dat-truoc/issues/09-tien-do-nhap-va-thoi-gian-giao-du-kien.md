# 09: Thời gian giao dự kiến thay đổi thì báo khách

**What to build:**
- Khi nhân viên đổi thời gian giao dự kiến của đợt, mọi khách đã cọc mà chưa về hàng nhận email nêu thời gian cũ và mới. Trang đơn của khách luôn hiện thời gian giao dự kiến hiện tại của đợt, cạnh thời gian lúc đặt.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Sửa đợt (ticket 02) mà đổi "từ ngày" hoặc "đến ngày" → trong cùng transaction, xếp email cho mỗi đơn của đợt đang `deposit_paid` và chưa `arrived_at`. Sự kiện đơn ghi thời gian cũ và mới
- [ ] Các thay đổi khác (suất, hạn đóng, trạng thái nhập hàng, ghi chú) không gửi email
- [ ] Trang đơn (khách và admin): thời gian giao dự kiến hiện tại của đợt, và thời gian lúc đặt nếu khác
- [ ] Test qua HTTP: đổi thời gian thì gửi đúng một email cho mỗi đơn đã cọc chưa về; đơn chờ cọc, đơn đã về, đơn hủy không nhận; sửa trường khác thì không gửi; lưu lại cùng thời gian không gửi

Spec: mục "Đợt đặt trước", "Email".
