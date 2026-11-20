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

**Status:** ready-for-agent

- [ ] `GET /api/admin/reports/exceptions` theo spec mục "Bảng ngoại lệ". Hằng số `STALE_REFUND_DAYS = 3` và `LOW_STOCK_THRESHOLD = 2` đặt ở `api/src/reports/`. Mục quá hạn phần còn lại dùng chung điều kiện với `preorder-campaigns/attention`.
- [ ] Web: khối "Cần xử lý" ở `/admin`. Các số đếm cũ giữ nguyên. Người không có quyền không thấy khối và không gọi API.
- [ ] Test, mỗi mục có một ca vào và một ca không vào:
  - hoàn 2 ngày không treo;
  - tồn − giữ = 3 không sắp hết;
  - biến thể ngừng bán hay sản phẩm nháp không vào;
  - đơn trễ hẹn đã giao không vào;
  - yêu cầu đã kết thúc không vào.

  Thêm: 403 khi không có quyền.

Spec: "Bảng ngoại lệ".
