# 08: Bảng ngoại lệ ở trang chủ quản trị

**What to build:** Khối "Cần xử lý" ở `/admin` cho người có `report.view`. Có sáu mục:
- cần đối soát;
- hoàn tiền treo quá 3 ngày;
- quá hạn phần còn lại;
- đặt trước trễ hẹn;
- yêu cầu chưa ai nhận;
- sắp hết hàng.

Mỗi mục có số đếm, tối đa 10 dòng và link tới màn xử lý.

**Blocked by:** 01

**Status:** resolved

- [x] `GET /api/admin/reports/exceptions` theo spec mục "Bảng ngoại lệ". Hằng số `STALE_REFUND_DAYS = 3` và `LOW_STOCK_THRESHOLD = 2` đặt ở `api/src/reports/`. Mục quá hạn phần còn lại dùng chung điều kiện với `preorder-campaigns/attention`.
- [x] Web: khối "Cần xử lý" ở `/admin`. Các số đếm cũ giữ nguyên. Người không có quyền không thấy khối và không gọi API.
- [x] Test, mỗi mục có một ca vào và một ca không vào:
  - hoàn 2 ngày không treo;
  - tồn − giữ = 3 không sắp hết;
  - biến thể ngừng bán hay sản phẩm nháp không vào;
  - đơn trễ hẹn đã giao không vào;
  - yêu cầu đã kết thúc không vào.

  Thêm: 403 khi không có quyền.

Spec: "Bảng ngoại lệ".

## Quyết định khi triển khai

- **API:** `GET /api/admin/reports/exceptions`, không theo kỳ. Mỗi mục trả `{ count, items }` (tối đa 10 dòng, việc cũ nhất trước). Response kèm `thresholds` để trang ghi đúng số ngày và số cái.
- **Ngưỡng:** `STALE_REFUND_DAYS = 3`, `LOW_STOCK_THRESHOLD = 2`, đặt ở `api/src/reports/exceptions.ts`.
- **Đặt trước trễ hẹn** chỉ gồm đơn `processing` (đã cọc). Đơn chờ cọc chưa phải cam kết và sẽ tự hết hạn. So `deliveryTo` (cột `DATE`) với ngày hôm nay theo giờ VN.
- **Quá hạn phần còn lại** dùng `DEPOSITED_PREORDER` + `remainderOverdueAt`, cùng điều kiện với `preorder-campaigns/attention`.
- **Yêu cầu chưa ai nhận** = trạng thái chưa kết thúc (`new`, `in_progress`, `waiting_customer`) và không có người phụ trách.
- **Sắp hết:** số đếm lấy từ toàn bộ biến thể khớp điều kiện, vì số biến thể nhỏ, rồi cắt 10 dòng đầu, sắp theo số còn bán được tăng dần.
- **Web:** component `AdminExceptionsPanel` đặt ở đầu `/admin`, chỉ render khi `canOpen('/admin/reports')`. Mỗi thẻ có số đếm, danh sách ngắn, link "và N việc khác" khi còn nữa, và link tới màn xử lý lọc theo `canOpen`. Các số đếm cũ của trang chủ giữ nguyên.
