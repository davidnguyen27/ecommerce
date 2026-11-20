# 07: Báo cáo đổi trả và bảo hành

**What to build:** Tab Đổi trả gồm:
- số yêu cầu trả và đổi theo kết quả;
- số lượng theo lý do × nhóm hàng;
- tỷ lệ trả theo nhóm hàng;
- số yêu cầu bảo hành theo kết quả.

**Blocked by:** 01

**Status:** resolved

- [x] `GET /api/admin/reports/returns` theo spec mục "Đổi trả". Tỷ lệ trả = số lượng trả đã chấp nhận / số lượng đã giao trong kỳ, theo nhóm hàng.
- [x] Web: tab Đổi trả, có ghi chú rằng tử số và mẫu số không cùng tập đơn.
- [x] Test:
  - đếm theo loại × kết quả (chưa quyết, chấp nhận, từ chối);
  - số lượng theo lý do × nhóm hàng;
  - tỷ lệ trả đúng;
  - nhóm hàng không giao gì thì `null`;
  - bảo hành theo kết quả, chưa có kết quả là đang xử lý.

Spec: "Đổi trả".

## Quyết định khi triển khai

- **API:** `GET /api/admin/reports/returns?from&to`. Có bốn truy vấn:
  - yêu cầu trả/đổi theo quyết định;
  - dòng yêu cầu theo lý do × nhóm hàng;
  - số cái đã giao trong kỳ theo nhóm hàng;
  - bảo hành theo kết quả.
- **Bảng dòng** gồm cả yêu cầu đổi. Dòng đổi không có lý do (`reason: null`), nên web gom chúng thành một hàng "Đổi hàng". Bảng tính mọi yêu cầu tạo trong kỳ, kể cả đã từ chối.
- **Tỷ lệ trả**: tử số chỉ lấy dòng của yêu cầu trả đã chấp nhận. Nhóm hàng chỉ hiện khi có hàng giao hoặc trả trong kỳ.
- **Kết quả bảo hành** có thêm hai giá trị ngoài `WarrantyOutcome`: `declined` (yêu cầu bị từ chối tiếp nhận, chưa có kết quả) và `in_progress`. Kết quả luôn có đủ mọi giá trị.
- Sau ticket này cả 6 tab đã xong, nên cờ `ready` và nhãn "Sắp có" trong trang cha đã gỡ.
