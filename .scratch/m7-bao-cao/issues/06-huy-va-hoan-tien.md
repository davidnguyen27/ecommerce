# 06: Hủy đơn và hoàn tiền

**What to build:** Tab Hủy & hoàn tiền gồm:
- tỷ lệ hủy trên đơn đã xác nhận, chia theo lý do và hình thức bán;
- đơn bỏ dở theo lý do;
- hoàn tiền tạo trong kỳ theo nguồn × trạng thái.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `GET /api/admin/reports/cancellations` theo spec mục "Hủy & hoàn tiền":
  - đơn đã xác nhận = có sự kiện `paid`, `deposit_paid` hoặc `restored`;
  - đơn bị hủy khi đã nhận tiền là đơn có `cancelCause`;
  - đơn bỏ dở = đã hủy, không có `cancelCause`, chia theo `cancelReason`.
- [ ] Web: tab Hủy & hoàn tiền. Mẫu số 0 hiện "—".
- [ ] Test:
  - đơn hết hạn chưa trả, khách tự hủy, nhân viên hủy khi chưa trả đều là bỏ dở;
  - đơn đã trả bị hủy vào tỷ lệ đúng lý do và hình thức bán;
  - đơn khôi phục từ đối soát là đơn đã xác nhận;
  - hoàn tiền nhóm đúng;
  - mẫu số 0 trả `null`.

Spec: "Hủy & hoàn tiền". GLOSSARY: "Đơn đã xác nhận", "Đơn bỏ dở".
