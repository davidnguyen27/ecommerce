# 01: Nền báo cáo và doanh thu theo ngày

**What to build:**
- Quyền `report.view` và mục menu Báo cáo, có bộ chọn kỳ.
- Tab Doanh thu với bảng theo ngày/tháng. Đây là tracer: đi đủ từ quyền, kỳ giờ VN, truy vấn tới trang. Các tab sau dùng lại khung này.

**Blocked by:** —

**Status:** resolved

- [x] `report.view` trong `Permission` (`shared/src/staff.ts`), cấp cho accountant; owner tự có.
- [x] `api/src/reports/period.ts`: parse `from`, `to`, `groupBy`; đổi sang mốc UTC theo Asia/Ho_Chi_Minh; 400 khi `from > to` hay quá 366 ngày. Schema ở `shared/src/reports.ts`.
- [x] `GET /api/admin/reports/revenue` (`report.view`), theo spec mục "Doanh thu":
  - mỗi kỳ: ngày/tháng, số đơn đã giao, doanh thu gộp tách hàng sẵn / đặt trước, hàng trả lại, doanh thu thuần, phí giao, mất cọc;
  - dòng tổng.

  Ngày giao lấy từ sự kiện `delivered`.
- [x] Web:
  - `/admin/reports` với 6 tab (5 tab chưa làm hiện "Sắp có");
  - bộ chọn kỳ nằm trên query string, mặc định từ ngày 1 tháng này tới hôm nay;
  - tab Doanh thu: ô tổng + bảng;
  - menu chỉ hiện khi có `report.view`.
- [x] Test qua HTTP:
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

## Quyết định khi triển khai

- API: `GET /api/admin/reports/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=day|month`, quyền `report.view` đặt ở router `/reports`.
- Kiểm kỳ nằm trong schema `ReportQuery` (`shared/src/reports.ts`): `from > to` hay quá 366 ngày thì 400 với lỗi ở trường `to`. Web dùng cùng schema để báo lỗi trước khi gọi API.
- `api/src/reports/period.ts`:
  - kỳ đổi ra `[start, end)` UTC theo độ lệch cố định UTC+7 (Việt Nam không đổi giờ mùa hè);
  - `inPeriod` so cột `TIMESTAMP` (giờ UTC) với mốc ép về UTC, nên không phụ thuộc `TimeZone` của phiên DB;
  - `bucketOf` nhóm bằng `to_char((cột AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh', …)`.

  Mọi ngày/tháng của kỳ đều có dòng, kể cả khi không có số.
- Mất cọc trừ mọi khoản hoàn không `failed` của đơn, kể cả khoản đang hoàn. Chỉ tính khi số còn lại > 0.
- Test cần đặt ngày giao hay ngày nhận tiền cụ thể. `test/support/backdate.ts` tạm tắt trigger chỉ-ghi-thêm của `order_event`/`payment_transaction` trong một transaction trên DB riêng của test, rồi sửa thời điểm.
- Web:
  - `/admin/reports` là trang cha, có tab và bộ chọn kỳ (query string, qua `useReportPeriod`), render `<NuxtPage />`;
  - `/admin/reports` tự chuyển sang tab Doanh thu;
  - tab chưa làm hiện "Sắp có";
  - menu "Báo cáo" nằm trong nhóm Tổng quan.
- Sửa sau review: **hàng trả lại** gồm cả khoản hoàn tạo lại (`retry`) từ một khoản hoàn trả hàng thất bại. Truy vấn quy về nguồn gốc đầu chuỗi qua `REFUND_ROOTS` (`api/src/reports/sql.ts`), giống Tiền thu và Hủy & hoàn tiền. Có test riêng.
