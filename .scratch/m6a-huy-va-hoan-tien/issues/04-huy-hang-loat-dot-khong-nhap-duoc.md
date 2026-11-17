# 04: Hủy hàng loạt khi đợt đặt trước không nhập được hàng

**What to build:**
- Khi nhà cung cấp báo không có hàng, nhân viên bán hàng bấm một lần ở chi tiết đợt để:
  - đóng đợt;
  - hủy mọi đơn đã cọc chưa có hàng về, mỗi đơn có hoàn tiền đủ;
  - gửi email cho từng khách.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `POST /api/admin/preorder-campaigns/:id/cancel-unsupplied`, cần cả `order.cancel_paid` và `preorder.manage`, body `{ note }` bắt buộc. Trong một transaction:
  - đóng đợt nếu đang mở;
  - hủy các đơn `processing` + `deposit_paid` có `arrived_at` trống, với `supply_failed` và hoàn đủ, qua cùng hàm hủy của ticket 02/03;
  - phần đã giữ một phần thành hàng sẵn, không chia lại cho đơn nào trong đợt;
  - trả danh sách mã đơn đã hủy.

  Audit: một dòng `preorder_campaign.cancel_unsupplied` cho thao tác, cộng một dòng cho mỗi đơn.
- [ ] Endpoint xem trước (hoặc trả kèm chi tiết đợt): số đơn sẽ bị hủy và tổng tiền sẽ hoàn, cho hộp xác nhận.
- [ ] Web admin: nút "Hủy các đơn chờ hàng (không nhập được)" ở chi tiết đợt, hộp xác nhận ghi số đơn và tổng tiền, ô ghi chú bắt buộc.
- [ ] Test qua HTTP:
  - chỉ đơn đã cọc chưa về bị hủy; đơn đã về, đơn đã trả đủ và đơn chờ cọc không đổi (đơn chờ cọc vẫn tự hết hạn như M4);
  - mỗi đơn có hoàn tiền đủ và email;
  - đợt bị đóng;
  - phần giữ một phần thành hàng sẵn;
  - thiếu một trong hai quyền thì 403;
  - gọi lần hai không hủy thêm gì.

Spec: mục "Hủy hàng loạt khi đợt không nhập được hàng".
