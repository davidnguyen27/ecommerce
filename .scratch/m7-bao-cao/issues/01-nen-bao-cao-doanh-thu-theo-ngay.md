# 01: Nền báo cáo và doanh thu theo ngày

**What to build:**
- Quyền `report.view` và mục menu Báo cáo, có bộ chọn kỳ.
- Tab Doanh thu với bảng theo ngày/tháng. Đây là tracer: đi đủ từ quyền, kỳ giờ VN, truy vấn tới trang. Các tab sau dùng lại khung này.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] `report.view` trong `Permission` (`shared/src/staff.ts`), cấp cho accountant; owner tự có.
- [ ] `api/src/reports/period.ts`: parse `from`, `to`, `groupBy`; đổi sang mốc UTC theo Asia/Ho_Chi_Minh; 400 khi `from > to` hay quá 366 ngày. Schema ở `shared/src/reports.ts`.
- [ ] `GET /api/admin/reports/revenue` (`report.view`), theo spec mục "Doanh thu":
  - mỗi kỳ: ngày/tháng, số đơn đã giao, doanh thu gộp tách hàng sẵn / đặt trước, hàng trả lại, doanh thu thuần, phí giao, mất cọc;
  - dòng tổng.

  Ngày giao lấy từ sự kiện `delivered`.
- [ ] Web:
  - `/admin/reports` với 6 tab (5 tab chưa làm hiện "Sắp có");
  - bộ chọn kỳ nằm trên query string, mặc định từ ngày 1 tháng này tới hôm nay;
  - tab Doanh thu: ô tổng + bảng;
  - menu chỉ hiện khi có `report.view`.
- [ ] Test qua HTTP:
  - 403 khi không có quyền; accountant xem được;
  - ranh giới ngày VN (23:30 ngày 31);
  - 400 với kỳ sai;
  - đơn chưa giao không tính;
  - đơn đặt trước cọc kỳ trước, giao kỳ này thì tính kỳ này;
  - phí giao, mất cọc ở cột riêng;
  - khoản hoàn `return` đã xong trừ đúng ngày, khoản chưa xong không trừ;
  - đổi hàng không đổi số;
  - nhóm theo tháng.

Spec: "Chung", "Doanh thu", "Web".
