# 03: Tiền thu, cọc đang giữ, còn phải thu

**What to build:** Tab Tiền thu gồm:
- tiền vào theo ngày/tháng, chia theo mục đích;
- tiền ra (hoàn đã xong) chia theo nguồn;
- tiền thu thuần;
- bốn ô tại thời điểm xem: cọc đang giữ, còn phải thu, đang hoàn, cần đối soát.

**Blocked by:** 01

**Status:** resolved

- [x] `GET /api/admin/reports/collections` theo spec mục "Tiền thu":
  - tiền vào theo `paidAt` và `purpose`;
  - tiền ra là khoản hoàn `succeeded` theo `completedAt` và `origin`;
  - các ô tại thời điểm xem. Còn phải thu dùng `remainingOf` và `DEPOSITED_PREORDER`.
- [x] Web: tab Tiền thu (bốn ô ở đầu, bảng theo kỳ).
- [x] Test:
  - giao dịch chia đúng mục đích;
  - giao dịch về sau khi đơn hủy vẫn là tiền vào;
  - hoàn `pending`/`processing`/`failed` không trừ;
  - cọc đang giữ và còn phải thu đúng với đơn đã cọc, đã về hàng, đã giao, đã hủy;
  - đang hoàn và cần đối soát đúng số và tổng.

Spec: "Tiền thu".

## Quyết định khi triển khai

- API: `GET /api/admin/reports/collections`, cùng query và quyền với doanh thu. Mỗi dòng có tiền vào chia theo mục đích, tiền ra chia theo nguồn, và tiền thu thuần. Kèm `snapshot` gồm các số tại thời điểm xem.
- **Tiền ra chỉ có ba nguồn:** hủy, đối soát, trả hàng. Khoản `retry` được quy về nguồn của khoản gốc đầu chuỗi (CTE đệ quy theo `retry_of_id`), để chủ DN không thấy một cột "tạo lại" khó hiểu.
- **Cọc đang giữ** = tiền đã nhận − tiền đã hoàn xong, của đơn đặt trước chưa giao và chưa hủy. Số này gồm cả phần còn lại nếu khách đã trả mà hàng chưa giao; trang ghi rõ điều này. Chỉ đếm đơn có số > 0.
- **Còn phải thu** = tổng (`total − depositAmount`) của `DEPOSITED_PREORDER`, tức `remainingOf` tính bằng aggregate.
- Đang hoàn và cần đối soát dùng `aggregate` của Prisma. Ô "Cần đối soát" trên trang link tới `/admin/reconciliation`.
