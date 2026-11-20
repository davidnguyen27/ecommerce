# 06: Hủy đơn và hoàn tiền

**What to build:** Tab Hủy & hoàn tiền gồm:
- tỷ lệ hủy trên đơn đã xác nhận, chia theo lý do và hình thức bán;
- đơn bỏ dở theo lý do;
- hoàn tiền tạo trong kỳ theo nguồn × trạng thái.

**Blocked by:** 01

**Status:** resolved

- [x] `GET /api/admin/reports/cancellations` theo spec mục "Hủy & hoàn tiền":
  - đơn đã xác nhận = có sự kiện `paid`, `deposit_paid` hoặc `restored`;
  - đơn bị hủy khi đã nhận tiền là đơn có `cancelCause`;
  - đơn bỏ dở = đã hủy, không có `cancelCause`, chia theo `cancelReason`.
- [x] Web: tab Hủy & hoàn tiền. Mẫu số 0 hiện "—".
- [x] Test:
  - đơn hết hạn chưa trả, khách tự hủy, nhân viên hủy khi chưa trả đều là bỏ dở;
  - đơn đã trả bị hủy vào tỷ lệ đúng lý do và hình thức bán;
  - đơn khôi phục từ đối soát là đơn đã xác nhận;
  - hoàn tiền nhóm đúng;
  - mẫu số 0 trả `null`.

Spec: "Hủy & hoàn tiền". GLOSSARY: "Đơn đã xác nhận", "Đơn bỏ dở".

## Quyết định khi triển khai

- **API:** `GET /api/admin/reports/cancellations?from&to`. Một truy vấn nhóm đơn tạo trong kỳ theo (hình thức bán, đã hủy, `cancelCause`, `cancelReason`, đã xác nhận); phần còn lại cộng trong JS.
- **Đơn đã xác nhận** = có sự kiện `paid`, `deposit_paid` hoặc `restored`.
- **Đơn bị hủy khi đã nhận tiền** = đơn đã xác nhận, đã hủy, có `cancelCause`.
- **Đơn bỏ dở** = đơn đã hủy, không có `cancelCause`, đếm theo `cancelReason`. Gồm cả đơn hết hạn mà tiền về sau đó rồi được giải quyết bằng hoàn tiền (không khôi phục).
- `byCause` và `abandoned` luôn có đủ mọi giá trị enum, kể cả giá trị bằng 0, để bảng ổn định. Tỷ lệ là số 0–1, bằng `null` khi mẫu số bằng 0.
- **Hoàn tiền** nhóm theo nguồn gốc đầu chuỗi tạo lại, qua CTE `REFUND_ROOTS` tách ra từ `collections.ts` (dùng chung với tiền thu), nhân với trạng thái hiện tại. Kỳ theo ngày tạo khoản hoàn.
- **Test** tách đơn bỏ dở sang một test riêng, vì đặt mua và đặt trước dùng chung giới hạn 5 lần/giờ/IP.
