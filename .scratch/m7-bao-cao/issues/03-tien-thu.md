# 03: Tiền thu, cọc đang giữ, còn phải thu

**What to build:** Tab Tiền thu gồm:
- tiền vào theo ngày/tháng, chia theo mục đích;
- tiền ra (hoàn đã xong) chia theo nguồn;
- tiền thu thuần;
- bốn ô tại thời điểm xem: cọc đang giữ, còn phải thu, đang hoàn, cần đối soát.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `GET /api/admin/reports/collections` theo spec mục "Tiền thu":
  - tiền vào theo `paidAt` và `purpose`;
  - tiền ra là khoản hoàn `succeeded` theo `completedAt` và `origin`;
  - các ô tại thời điểm xem. Còn phải thu dùng `remainingOf` và `DEPOSITED_PREORDER`.
- [ ] Web: tab Tiền thu (bốn ô ở đầu, bảng theo kỳ).
- [ ] Test:
  - giao dịch chia đúng mục đích;
  - giao dịch về sau khi đơn hủy vẫn là tiền vào;
  - hoàn `pending`/`processing`/`failed` không trừ;
  - cọc đang giữ và còn phải thu đúng với đơn đã cọc, đã về hàng, đã giao, đã hủy;
  - đang hoàn và cần đối soát đúng số và tổng.

Spec: "Tiền thu".
