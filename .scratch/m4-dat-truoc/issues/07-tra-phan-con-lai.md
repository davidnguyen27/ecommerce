# 07: Trả phần còn lại

**What to build:**
- Đơn đặt trước đã về hàng có nút "Trả phần còn lại" trên trang đơn (qua token và trong tài khoản). Khách trả qua VNPAY; thành công thì đơn đã trả đủ và vào danh sách cần soạn như đơn hàng sẵn. Trả không thành công thì thử lại được, đơn không bị hủy.

**Blocked by:** 06

**Status:** resolved

- [x] `POST /api/orders/:code/pay-remainder?token=…` và `POST /api/account/orders/:code/pay-remainder`: chỉ khi đơn `deposit_paid` và đã về hàng, ngoài ra 409. Mỗi lần gọi tạo một link `remainder` mới, số tiền bằng phần còn lại, hạn 15 phút. Link hết hạn không đổi đơn
- [x] Hàm ghi nhận: giao dịch `remainder` đúng bằng phần còn lại cho đơn `deposit_paid` đã về hàng → `paid`, xóa cờ quá hạn nếu có, email "đã nhận thanh toán" của M3. Trả khi hàng chưa về hay khi đã `paid` → đối soát (`extra_payment`); lệch tiền → `amount_mismatch`
- [x] Giới hạn tần suất cho `pay-remainder` theo IP (dùng `enforceRateLimits`)
- [x] Soạn, bàn giao, giao của đơn `preorder` đã `paid` dùng lại M3 (trừ `on_hand` và `reserved`, ghi sổ `sale`)
- [x] Web: nút trên `OrderView`, trang kết quả dùng lại M3
- [x] Test qua HTTP: trước khi về hàng 409; link đúng số tiền; trả thành công → `paid` và soạn được; trả hai lần → đối soát; lệch tiền → đối soát; link hết hạn không đổi đơn; bàn giao đơn đặt trước trừ đúng tồn và đang giữ

Spec: mục "Thanh toán".

**Quyết định khi triển khai (2026-11-16):**
- Không có migration.
- `createRemainderLink` (`api/src/preorders/remainder.ts`):
  - khóa đơn `FOR UPDATE`; chỉ đơn đặt trước `processing` + `deposit_paid` có `arrived_at` mới được tạo link, ngoài ra 409 ("không có phần còn lại cần trả" hay "hàng chưa về đủ");
  - mỗi lần gọi tạo một link `remainder` mới qua `createOrderPaymentLink`, số tiền = tổng − cọc, hạn `RESERVATION_MINUTES` (15) phút;
  - link hết hạn không có job nào xử lý, đơn giữ nguyên.
  - Chỗ ticket 01 để lại (mã `vnp_TxnRef` chỉ phân biệt tới giây): hai lần bấm trong cùng một giây làm trùng unique `payment_link.gateway_reference`, nên bắt lỗi đó và trả 409 "Vừa tạo link thanh toán, vui lòng thử lại sau vài giây".
- Route:
  - `POST /api/orders/:code/pay-remainder?token=…`: người cầm link tra cứu trả được, như hủy đơn chờ thanh toán; trả `token: null`;
  - `POST /api/account/orders/:code/pay-remainder`: đơn của khách khác là 404. Route này **cấp thêm một token tra cứu** (chỉ lưu hash) và trả trong response, để trang kết quả `/don-hang/:code?ket-qua=1` (vốn đọc token từ sessionStorage) mở được đơn khi cổng đưa khách về.
  Cả hai dùng giới hạn mới `payRemainderPerIp` (10 lần/giờ/IP, số tạm).
- `recordPayment` tách hàm `awaitedPayment(order)`: khoản đơn đang chờ là `full` (đơn hàng sẵn chờ thanh toán), `deposit` (đơn đặt trước chờ cọc) hoặc `remainder` (đơn đặt trước đã cọc và đã về hàng, số tiền = tổng − cọc).
  - Tổng các giao dịch đúng mục đích bằng đúng số phải nhận thì tiến một bước; phần còn lại → `paid`, sự kiện `paid`, email "đã nhận thanh toán" của M3.
  - Lý do đối soát: đơn đang chờ đúng mục đích của giao dịch mà tiền chưa khớp → `amount_mismatch`; đơn không chờ khoản nào (trả phần còn lại khi hàng chưa về, hay trả lần hai) → `extra_payment`; đơn đã hủy → `paid_after_cancel`. Các trường hợp của M3 cho kết quả như cũ.
- "Xóa cờ quá hạn nếu có": ticket 08 mới thêm cờ quá hạn, nên ticket 08 sẽ nối việc xóa cờ vào nhánh `paid` này.
- Soạn, bàn giao và giao đơn đặt trước đã `paid` dùng lại M3 mà không phải sửa gì: bàn giao nhả `reserved_quantity` (ticket 06), test kiểm tồn, số đang giữ và dòng sổ `sale`.
- Web:
  - `OrderView` có khối "Hàng đã về. Vui lòng trả phần còn lại … trước …" với nút "Trả phần còn lại" (emit `payRemainder`, prop `payingRemainder`); dòng "Hàng đã về đủ lúc …" thay cho hạn trả ở cuối trang;
  - trang đơn qua token gọi route token rồi nhớ token; trang đơn trong tài khoản gọi route tài khoản rồi nhớ token được cấp; cả hai chuyển tới `checkoutUrl`;
  - trang kết quả hiện "Chưa nhận được thanh toán … Kiểm tra lại" cả khi đơn đã về hàng mà chưa nhận phần còn lại.
- Test: `api/test/preorder-remainder.test.ts` (8 test). Toàn bộ bộ test API (47 file, 514 test) và test web (12) qua.
- **Chưa xem bằng trình duyệt.**
