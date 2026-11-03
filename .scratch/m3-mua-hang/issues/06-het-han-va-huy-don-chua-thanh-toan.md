# 06: Hết hạn và hủy đơn chưa thanh toán

**What to build:**
- Đơn chưa thanh toán quá 15 phút thì tự hủy và nhả hàng.
- Khách tự hủy đơn chưa thanh toán qua link token hoặc trong tài khoản. Nhân viên hủy hộ khi khách gọi báo thôi.
- Tiền về sau khi đơn đã hủy thì cần đối soát, đơn vẫn giữ trạng thái hủy.
- Cổng giả lập có nút "Giả lập hết hạn".

**Blocked by:** 05 (Ghi nhận thanh toán)

**Status:** resolved

- [x] Một hàm hủy đơn dùng chung cho hết hạn, khách hủy và nhân viên hủy:
  - khóa đơn; chỉ hủy đơn còn `pending_payment`, đơn đã trả thì trả 409;
  - nhả giữ hàng;
  - ghi sự kiện đơn với đúng actor;
  - gọi cổng hủy link; lỗi khi hủy link chỉ log, không chặn.

  Chạy lại trên đơn đã hủy thì không đổi gì.
- [x] Hết hạn có hai cơ chế:
  - khi tạo đơn, xếp job pg-boss `expire-order` chạy đúng lúc hết hạn;
  - job định kỳ mỗi phút quét các đơn `pending_payment` đã quá hạn.

  Job chỉ hủy đơn đã quá hạn tính theo `now`.
- [x] Endpoint hủy:
  - khách vãng lai: `POST /api/orders/:code/cancel?token=…`;
  - khách đăng nhập: `POST /api/account/orders/:code/cancel`, chỉ hủy được đơn của chính mình, đơn của người khác trả 404;
  - nhân viên: `POST /api/admin/orders/:code/cancel`, cần quyền `order.fulfill`, đi qua `audited()`. Nút hủy ở admin làm ở ticket 07.
- [x] Thêm test cho nhánh tiền về sau khi đơn đã hủy: cần đối soát `paid_after_cancel`
- [x] Web:
  - nút hủy trong `OrderView`, chỉ hiện khi đơn còn chờ thanh toán;
  - gắn nút vào trang đơn qua token, và vào trang đơn trong tài khoản nếu ticket 11 đã có trang đó (nếu chưa, ticket 11 sẽ gắn);
  - đơn hết hạn hiện rõ, kèm nút quay lại giỏ hàng;
  - cổng giả lập có nút "Giả lập hết hạn".
- [x] Không gửi email khi đơn hết hạn hay khi khách tự hủy
- [x] Có test. Job hết hạn được gọi thẳng với `now` ở tương lai, kết quả kiểm qua HTTP:
  - hết hạn thì nhả giữ hàng và hủy link; chạy lại không đổi gì; không động tới đơn đã trả hay đơn chưa quá hạn;
  - khách hủy được bằng token và bằng tài khoản; token sai hoặc đơn của người khác thì không hủy được; không hủy được đơn đã trả;
  - nhân viên hủy cần `order.fulfill` và có ghi audit;
  - tiền về sau khi hủy: cần đối soát, đơn vẫn hủy

**Quyết định khi triển khai (2026-11-02):**
- Migration `20261102000600_order_cancellation`: enum `order_cancel_reason` (`expired | customer | staff`), cột `order.cancel_reason` và `order.cancelled_at`; check `order_cancellation_check`: có lý do khi và chỉ khi `status = cancelled`. Ticket 10 (khôi phục đơn) đọc `cancelReason`. Dựng đơn hủy bằng prisma giờ phải đặt cả hai cột.
- Shared: `OrderCancelReason`; `PublicOrder` thêm `cancelReason`, `cancelledAt`. `SimulatedExpiryRequest { orderCode }` ở `shared/src/payments.ts`. Permission mới `order.fulfill` (owner, warehouse) trong `Permission` và `ROLE_PERMISSIONS`; ticket 07 thêm `order.view`.
- Module `api/src/orders/cancel-order.ts`:
  - `cancelInTransaction(tx, orderId, Cancellation)` khóa đơn `FOR UPDATE` (cùng khóa với `recordPayment`), nhả hàng bằng `releaseStock`, đặt `cancelled` + lý do + `cancelledAt`, `reservedUntil = null`, ghi sự kiện `cancelled` (`data: { reason }`; actor `system` khi hết hạn, `customer` kèm `customerId` khi hủy trong tài khoản, `staff`). Trả `CancelOutcome`: `cancelled | already_cancelled | not_pending | not_due`. Đã hủy thì không đổi gì.
  - `Cancellation`: `{ reason: 'expired', overdueAt? } | { reason: 'customer', customerId? } | { reason: 'staff', staffId }`. Có `overdueAt` thì chỉ hủy khi `reservedUntil <= overdueAt`.
  - `cancelOrder(deps, orderId, cancellation)` = transaction rồi `cancelPaymentLink` (lỗi chỉ log "Không hủy được link thanh toán"). `assertCancellable(outcome)` ném 409 cho `not_pending`. `expireOrder(deps, orderId, now)`, `expireOverdueOrders(deps, now)` (trả số đơn đã hủy). `CancelDeps = { prisma, payments, logger }`.
  - `OrderEventKind` thêm `cancelled`.
- Job: `Jobs` nhận thêm `payments`; implements `OrderExpiryQueue.scheduleOrderExpiry(db, orderId, at)`, inject qua `AppDeps.orderExpiry`. Checkout xếp `expire-order` (`data: { orderId }`, `startAfter = reservedUntil`) trong transaction đặt mua. Lịch `expire-overdue-orders` chạy `* * * * *`.
- Route:
  - `POST /api/orders/:code/cancel?token=…` (trong `publicOrderRoutes`): trả `PublicOrder` 200, kể cả khi đã hủy từ trước; token sai 404; đã trả 409. Sự kiện không gắn `customerId` vì người cầm link chưa chắc là người đặt.
  - `POST /api/account/orders/:code/cancel`: router riêng `accountOrderCancelRoutes(deps)` ở `api/src/routes/account-order-cancel.ts`, mount `/account/orders` trước `/account`, sau `requireAuth(secret, 'customer')`. Ticket 11 có `account-orders.ts` riêng nên merger gộp hai router (hoặc mount cả hai). Đơn không của mình hay mã lạ là 404; trả `PublicOrder` 200.
  - `POST /api/admin/orders/:code/cancel` (`adminOrderRoutes(prisma, payments)`, `api/src/routes/admin-orders.ts`; `adminRoutes` nhận thêm `payments`): `order.fulfill`, qua `audited()` với action `order.cancel`, entity `order`, `before { status }`, `after { status, cancelReason }`; 204; mã lạ 404; đã trả 409 và không ghi audit. Ticket 07 thêm danh sách, chi tiết vào file này.
  - `POST /api/payments/simulator/expired` (chỉ khi cổng giả lập): `cancelOrder` lý do `expired` không có `overdueAt`; 204, mã lạ 404, đã trả 409.
- `InMemoryPaymentGateway.failCancel`. `createTestApp` trả thêm `logger` để test gọi thẳng hàm job.
- Web: `OrderView` thêm prop `cancellable`, `cancelling`, event `cancel` (nút `data-testid="order-cancel"`, hỏi `confirm` trước); thông báo đơn hết hạn (`order-expired`) với nút "Quay lại giỏ hàng" (`order-back-to-cart`) đưa các dòng đơn trở lại giỏ (giá lúc đặt; trang giỏ tự báo đổi giá/tồn) rồi mở `/gio-hang`, vì giỏ đã được làm trống lúc đặt mua; đơn hủy vì lý do khác hiện `order-cancelled`. Trang `/don-hang/[code]` gắn nút hủy; ticket 11 gắn vào trang đơn trong tài khoản. Trang giả lập: nút `simulate-expired` gọi API rồi quay về `returnUrl`. Nhãn audit `order.cancel`, `order`. Smoke kiểm thêm chữ "Giả lập hết hạn". Chưa đi luồng bằng trình duyệt (ticket 14).
- Không gửi email khi hết hạn hay hủy (test kiểm hộp thư rỗng).
- Test: `api/test/order-cancel.test.ts` (14 test); `payments.test.ts` dựng đơn hủy qua endpoint token thay cho prisma.
- Cần chủ doanh nghiệp xác nhận: nút "Quay lại giỏ hàng" của đơn hết hạn bỏ lại các dòng đơn vào giỏ (cộng vào giỏ hiện có).
