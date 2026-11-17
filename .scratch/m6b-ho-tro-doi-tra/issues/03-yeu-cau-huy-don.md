# 03: Yêu cầu hủy đơn

**What to build:**
- Khách đã trả hoặc đã cọc gửi được yêu cầu hủy đơn khi hàng chưa giao đi.
- Nhân viên mở thao tác hủy của M6a ngay từ yêu cầu. Đơn hủy xong thì yêu cầu tự đóng.

**Blocked by:** 01

**Status:** resolved

- [x] Tạo yêu cầu loại `cancel`: chỉ khi đơn `processing`, đã nhận tiền (`paid` hoặc `deposit_paid`) và chưa bàn giao (`not_prepared`, `preparing`). Không thỏa thì 409 kèm lý do. Đơn chưa trả thì khách dùng nút hủy sẵn có.
- [x] `cancelPaidOrder` thành công thì mọi yêu cầu `cancel` đang mở của đơn sang `resolved`, kèm một tin hệ thống ("Đơn đã được hủy"), trong cùng transaction. Email "đã xong" của yêu cầu không gửi, vì khách đã nhận email "Đơn đã hủy".
- [x] Web:
  - form gửi yêu cầu chỉ hiện loại "Hủy đơn" khi đủ điều kiện;
  - trang yêu cầu ở admin có nút mở `AdminCancelPaidForm` của đơn (người có `order.cancel_paid`).
- [x] Test:
  - gửi được và không gửi được theo từng trạng thái đơn;
  - hủy đơn đóng yêu cầu và có tin hệ thống;
  - đơn đã bàn giao thì yêu cầu vẫn mở để nhân viên trả lời.

Spec: mục "Quy tắc" (hủy đơn).

**Quyết định khi triển khai (2026-11-17):**
- Điều kiện gửi yêu cầu hủy là hàm `canRequestCancel` trong `shared/src/orders.ts`, dùng chung cho API (lúc tạo) và web (hiện loại "Hủy đơn"): đơn `processing`, `paid` hoặc `deposit_paid`, `not_prepared` hoặc `preparing`. Hàm nằm ở `orders.ts` vì `orders.ts` đã import `support.ts`; đặt ngược lại sẽ thành import vòng.
- `createSupportRequest`: đọc trạng thái đơn dưới chính khóa `FOR UPDATE` dùng để đếm yêu cầu mở. Sai điều kiện thì 409, kèm lời hướng dẫn: đơn chưa trả thì tự hủy, đã giao thì gửi yêu cầu trả hàng. Mọi loại trừ `other` không có đơn thì 400.
- `CreatableSupportKind` (`other`, `cancel`) dùng cho cả khách và nhân viên tạo hộ. Nhân viên tạo hộ yêu cầu hủy mà không có mã đơn thì 400.
- `resolveCancelRequests` chạy trong transaction của `cancelPaidOrder`:
  - các yêu cầu hủy đang mở của đơn thành `resolved`, kèm tin hệ thống;
  - không gửi email "đã xong", vì khách đã nhận email "Đơn đã hủy";
  - đơn có sự kiện mới `support_resolved` với mã các yêu cầu đã đóng.

  Cách này áp cho mọi đường hủy đơn đã nhận tiền, kể cả hủy hàng loạt (ticket 04 của M6a).
- Đơn bàn giao sau khi khách gửi thì yêu cầu vẫn mở; nhân viên trả lời rồi đóng.
- Web:
  - `SupportRequests` có prop `canCancel`; khi đúng thì form có ô chọn "Hủy đơn đã thanh toán". Hai trang đơn truyền `canRequestCancel(order)`; trang tài khoản (không gắn đơn) thì không;
  - trang yêu cầu ở admin có khối "Khách xin hủy đơn" (người có `order.cancel_paid`). Bấm "Hủy đơn" thì nạp `AdminOrder` và mở `AdminCancelPaidForm` của M6a. Đơn không còn hủy được thì báo để nhân viên trả lời khách. Hủy xong thì nạp lại yêu cầu (đã tự đóng);
  - nhãn cho sự kiện `support_resolved`.
- Test `api/test/support-cancel.test.ts` (5 test). Chưa chạy thử giao diện trên trình duyệt; E2E ở ticket 07.
- Kết quả: 5 test mới qua; cả bộ test API 670/670.
