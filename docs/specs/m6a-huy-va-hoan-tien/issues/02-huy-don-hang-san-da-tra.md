# 02: Hủy đơn hàng sẵn đã trả

**What to build:**
- Nhân viên bán hàng hủy một đơn hàng sẵn đã trả nhưng chưa bàn giao vận chuyển, chọn lý do và đề xuất số tiền hoàn (mặc định toàn bộ, giảm thì phải ghi lý do). Hàng giữ được nhả, lượt mã giảm giá trống lại, khách nhận email.
- Trang đơn của khách hiện lý do hủy và các khoản hoàn.

**Blocked by:** 01

**Status:** resolved

- [x] Migration: `order` thêm `cancel_cause` (enum `changed_mind`, `remainder_overdue`, `supply_failed`, `delivery_failed`, `other`) và `cancel_note`. Check: hai cột có khi và chỉ khi đơn `cancelled` lúc đã nhận tiền. Đơn cũ thỏa check.
- [x] Hàm hủy đơn đã nhận tiền trong module đơn, dùng lại `lockForTransition`, chạy trong `audited()` (`order.cancel_paid`):
  - kiểm trạng thái cho phép theo spec, sai thì 409;
  - kiểm số hoàn: trong [0, số có thể hoàn]; thấp hơn mặc định thì `note` bắt buộc; `supply_failed` thì phải hoàn đủ;
  - nhả hàng bằng `releaseStock`;
  - đặt `cancelled` + `cancel_reason = staff` + `cancel_cause`/`cancel_note`;
  - thêm sự kiện đơn;
  - tạo hoàn tiền `pending` (`origin = cancellation`) khi số hoàn > 0;
  - xếp email.

  Viết hàm sao cho ticket 03 chỉ cần thêm nhánh nhả hàng đặt trước.
- [x] `POST /api/admin/orders/:code/cancel-paid` (`order.cancel_paid`), body `{ cause, refundAmount, note? }`. Schema shared cho request và lý do.
- [x] Email "Đơn đã hủy": mã đơn, lý do theo cách nói với khách, số tiền sẽ hoàn (hoặc không hoàn), lời mời liên hệ. Nội dung tạm.
- [x] `PublicOrder` (token và tài khoản) thêm lý do hủy theo cách nói với khách, `received`, và các khoản hoàn (số tiền, đang hoàn/đã hoàn, ngày). Không lộ ghi chú nội bộ, mã ngân hàng, người làm.
- [x] Web:
  - admin: nút "Hủy đơn" cho đơn đã nhận tiền khi có `order.cancel_paid`, mở hộp thoại (lý do, số đã nhận, ô số hoàn mặc định toàn bộ, ghi chú bắt buộc khi giảm, xác nhận);
  - khách: `OrderView` hiện lý do hủy và khối "Hoàn tiền".
- [x] Test qua HTTP:
  - hủy được ở `not_prepared` và `preparing`; ở `handed_over`, `delivered`, `failed` thì 409; đơn chưa trả thì 409 (dùng endpoint cũ);
  - tồn đang giữ giảm đúng;
  - lượt mã giảm giá trống lại;
  - số hoàn vượt thì 400; giảm mà thiếu ghi chú thì 400; số hoàn 0 thì không có hoàn tiền;
  - sales hủy được, warehouse và accountant bị 403;
  - hai yêu cầu song song thì đúng một thành công;
  - email được xếp;
  - trang khách không lộ trường nội bộ.

Spec: mục "Hủy đơn đã nhận tiền", "Email", "Web".

**Quyết định khi triển khai (2026-11-17):**
- Migration `20261117000500_order_cancel_cause` thêm enum `order_cancel_cause`, các cột `cancel_cause`, `cancel_note`, và check `order_cancel_cause_check`:
  - có lý do khi và chỉ khi đơn `cancelled` mà trạng thái thanh toán khác `unpaid`. Hủy không đổi trạng thái thanh toán (ADR 0014), nên "đã nhận tiền" chính là trạng thái thanh toán khác `unpaid`;
  - có lý do thì `cancel_reason = staff`;
  - có ghi chú thì phải có lý do.
- `api/src/orders/cancel-paid-order.ts`, hàm `cancelPaidOrder`:
  - khóa đơn `FOR UPDATE` rồi kiểm trạng thái. Sai trạng thái thì 409, nên hai yêu cầu song song chỉ một thành công;
  - không dùng `lockForTransition`: hàm đó đòi đúng một trạng thái giao hàng và đã trả đủ, còn ở đây cần hai trạng thái giao hàng và cả `deposit_paid`;
  - kiểm số hoàn bằng `invalidField` (400 gắn trường `refundAmount` hoặc `note`), giữ đúng mức lỗi của spec. `createRefund` vẫn tự kiểm lại dưới khóa;
  - đơn đặt trước trả 409 ("Chưa hủy được đơn đặt trước") cho tới ticket 03.
- Phần nhả hàng của `cancelInTransaction` được tách thành `releaseOrderReservations`, dùng chung cho cả hai đường hủy.
- Sự kiện đơn `cancelled` có thêm `cause` và `refundAmount`. Audit `order.cancel_paid` ghi `before` (ba trạng thái) và `after` (lý do, ghi chú, số hoàn, `refundId`).
- Email "Đơn hàng #… đã bị hủy":
  - lý do theo cách nói với khách;
  - số tiền sẽ hoàn, hoặc câu "không được hoàn tiền theo chính sách đã áp dụng cho đơn";
  - link tra cứu;
  - là bản nháp chờ chủ doanh nghiệp duyệt.
- `PublicOrder` có thêm `cancelCause`, `received`, `refunds` (`PublicRefund`: số tiền, `refunding`/`refunded`, ngày tạo, ngày xong). Khoản thất bại không hiện cho khách.
- `AdminOrder` có thêm `cancelNote`. `received` chuyển lên `PublicOrder`. `refunds` của admin thay cho bản của khách.
- `ORDER_VIEW_INCLUDE` nạp thêm số tiền giao dịch và các khoản hoàn.
- Web:
  - `AdminCancelPaidForm` mở bằng nút "Hủy đơn" ở đầu trang chi tiết, chỉ với đơn hàng sẵn ở `not_prepared`/`preparing` và người có `order.cancel_paid`. Chọn "Không nhập được hàng" thì ô số hoàn bị khóa ở mức đủ;
  - khối Trạng thái hiện lý do và ghi chú hủy; lịch sử thao tác hiện lý do và số hoàn;
  - `OrderView` của khách có câu lý do hủy và khối "Hoàn tiền" (`order-refunds`).
- Test `api/test/order-cancel-paid.test.ts` (9 test).
- Chưa chạy thử giao diện trên trình duyệt; E2E ở ticket 07.
