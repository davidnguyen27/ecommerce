# 02: Hủy đơn hàng sẵn đã trả

**What to build:**
- Nhân viên bán hàng hủy một đơn hàng sẵn đã trả nhưng chưa bàn giao vận chuyển, chọn lý do và đề xuất số tiền hoàn (mặc định toàn bộ, giảm thì phải ghi lý do). Hàng giữ được nhả, lượt mã giảm giá trống lại, khách nhận email.
- Trang đơn của khách hiện lý do hủy và các khoản hoàn.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Migration: `order` thêm `cancel_cause` (enum `changed_mind`, `remainder_overdue`, `supply_failed`, `delivery_failed`, `other`) và `cancel_note`. Check: hai cột có khi và chỉ khi đơn `cancelled` lúc đã nhận tiền. Đơn cũ thỏa check.
- [ ] Hàm hủy đơn đã nhận tiền trong module đơn, dùng lại `lockForTransition`, chạy trong `audited()` (`order.cancel_paid`):
  - kiểm trạng thái cho phép theo spec, sai thì 409;
  - kiểm số hoàn: trong [0, số có thể hoàn]; thấp hơn mặc định thì `note` bắt buộc; `supply_failed` thì phải hoàn đủ;
  - nhả hàng bằng `releaseStock`;
  - đặt `cancelled` + `cancel_reason = staff` + `cancel_cause`/`cancel_note`;
  - thêm sự kiện đơn;
  - tạo hoàn tiền `pending` (`origin = cancellation`) khi số hoàn > 0;
  - xếp email.

  Viết hàm sao cho ticket 03 chỉ cần thêm nhánh nhả hàng đặt trước.
- [ ] `POST /api/admin/orders/:code/cancel-paid` (`order.cancel_paid`), body `{ cause, refundAmount, note? }`. Schema shared cho request và lý do.
- [ ] Email "Đơn đã hủy": mã đơn, lý do theo cách nói với khách, số tiền sẽ hoàn (hoặc không hoàn), lời mời liên hệ. Nội dung tạm.
- [ ] `PublicOrder` (token và tài khoản) thêm lý do hủy theo cách nói với khách, `received`, và các khoản hoàn (số tiền, đang hoàn/đã hoàn, ngày). Không lộ ghi chú nội bộ, mã ngân hàng, người làm.
- [ ] Web:
  - admin: nút "Hủy đơn" cho đơn đã nhận tiền khi có `order.cancel_paid`, mở hộp thoại (lý do, số đã nhận, ô số hoàn mặc định toàn bộ, ghi chú bắt buộc khi giảm, xác nhận);
  - khách: `OrderView` hiện lý do hủy và khối "Hoàn tiền".
- [ ] Test qua HTTP:
  - hủy được ở `not_prepared` và `preparing`; ở `handed_over`, `delivered`, `failed` thì 409; đơn chưa trả thì 409 (dùng endpoint cũ);
  - tồn đang giữ giảm đúng;
  - lượt mã giảm giá trống lại;
  - số hoàn vượt thì 400; giảm mà thiếu ghi chú thì 400; số hoàn 0 thì không có hoàn tiền;
  - sales hủy được, warehouse và accountant bị 403;
  - hai yêu cầu song song thì đúng một thành công;
  - email được xếp;
  - trang khách không lộ trường nội bộ.

Spec: mục "Hủy đơn đã nhận tiền", "Email", "Web".
