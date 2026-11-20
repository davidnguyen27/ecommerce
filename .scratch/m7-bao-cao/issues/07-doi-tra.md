# 07: Báo cáo đổi trả và bảo hành

**What to build:** Tab Đổi trả gồm:
- số yêu cầu trả và đổi theo kết quả;
- số lượng theo lý do × nhóm hàng;
- tỷ lệ trả theo nhóm hàng;
- số yêu cầu bảo hành theo kết quả.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `GET /api/admin/reports/returns` theo spec mục "Đổi trả". Tỷ lệ trả = số lượng trả đã chấp nhận / số lượng đã giao trong kỳ, theo nhóm hàng.
- [ ] Web: tab Đổi trả, có ghi chú rằng tử số và mẫu số không cùng tập đơn.
- [ ] Test:
  - đếm theo loại × kết quả (chưa quyết, chấp nhận, từ chối);
  - số lượng theo lý do × nhóm hàng;
  - tỷ lệ trả đúng;
  - nhóm hàng không giao gì thì `null`;
  - bảo hành theo kết quả, chưa có kết quả là đang xử lý.

Spec: "Đổi trả".
