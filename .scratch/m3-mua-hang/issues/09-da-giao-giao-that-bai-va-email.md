# 09: Đã giao, giao thất bại và email giao hàng

**What to build:**
- Nhân viên kho đánh dấu đã giao (đơn hoàn tất) hoặc giao thất bại (đơn vẫn đang xử lý, chờ M6).
- Khách nhận email khi đơn đã bàn giao vận chuyển (kèm đơn vị vận chuyển và mã vận đơn) và khi giao thất bại.

**Blocked by:** 08 (Chuẩn bị và bàn giao vận chuyển)

**Status:** resolved

- [x] Hai chuyển trạng thái, cùng cần `order.fulfill` và đi qua `audited()`; sai cạnh thì 409:
  - `handed_over` → `delivered`: đơn hàng thành `completed`;
  - `handed_over` → `failed`: đơn hàng giữ `processing`.
- [x] Hai email, nội dung là bản nháp chờ chủ doanh nghiệp duyệt:
  - "đã bàn giao vận chuyển": đơn vị vận chuyển, mã vận đơn, link tra cứu. Xếp trong transaction bàn giao của ticket 08;
  - "giao thất bại": báo shop sẽ liên hệ.
- [x] Trang đơn của khách hiện mã vận đơn, và trạng thái giao hàng tách khỏi trạng thái thanh toán
- [x] Trang chi tiết đơn ở admin có hai nút "Đã giao" và "Giao thất bại"
- [x] Có test qua HTTP:
  - đã giao: đơn hoàn tất;
  - giao thất bại: đơn vẫn đang xử lý;
  - sai cạnh trạng thái thì 409;
  - email bàn giao và email giao thất bại mỗi loại gửi đúng một lần, có đủ nội dung chính

**Quyết định khi triển khai (2026-11-02):**
- Không cần migration: `order_event.kind` là text; `order_status`, `fulfillment_status` đã có `completed`, `delivered`, `failed`; check `order_handover_check` của ticket 08 vẫn đúng vì ba cột bàn giao giữ nguyên.
- Route (`admin-orders.ts`, cần `order.fulfill`, đi qua `audited()`, trả `AdminOrder` 200 qua `loadAdminOrder`; mã lạ 404):
  - `POST /api/admin/orders/:code/deliver`: `handed_over` → `delivered`, đơn thành `completed`. Audit `order.deliver` (`before { status: 'processing', fulfillmentStatus: 'handed_over' }`, `after { status: 'completed', fulfillmentStatus: 'delivered' }`), sự kiện `delivered`.
  - `POST /api/admin/orders/:code/delivery-failed`: `handed_over` → `failed`, đơn giữ `processing`. Audit `order.delivery_failed` (`before/after { fulfillmentStatus }`), sự kiện `delivery_failed`.
  - Sai cạnh (chưa bàn giao, đã giao, đã thất bại) thì 409 qua `lockForTransition` chung của ticket 08 (khóa `FOR UPDATE`, đơn phải `processing` + `paid`). `failed` → `delivered` cũng 409: xử lý đơn giao thất bại (giao lại, nhập lại kho, hoàn tiền) để M6.
- `api/src/orders/fulfill-order.ts`: `deliverOrder(tx, orderId, staffId)`, `failDelivery(tx, emails, orderId, staffId)`; `handOverOrder(tx, mail, orderId, staffId, shipment)` thêm tham số `FulfillmentMail = { emails, siteUrl }`. `adminRoutes`, `adminOrderRoutes` nhận thêm `mail: FulfillmentMail` (`app.ts` truyền `deps.emails`, `deps.siteUrl`).
- `OrderEventKind` thêm `delivered`, `delivery_failed` (data `{}`, actor staff).
- Email xếp bằng `emails.sendEmail(tx, …)` trong transaction của thao tác, nên rollback thì không gửi:
  - "Đơn hàng #<mã> đã được giao cho đơn vị vận chuyển": chào tên người nhận, đơn vị vận chuyển, mã vận đơn, link tra cứu có token mới (`issueOrderLookupUrl`).
  - "Giao hàng chưa thành công đơn hàng #<mã>": chào tên, đơn vị vận chuyển và mã vận đơn, câu "Shop sẽ liên hệ với bạn qua số điện thoại hoặc email để sắp xếp lại việc giao hàng."
  - Không gửi email khi đã giao (ticket không yêu cầu).
  - **Cần chủ doanh nghiệp xác nhận** nội dung hai email (bản nháp).
- Web:
  - `AdminFulfillmentPanel`: khi `handed_over` và `canFulfill`, nút "Đã giao" (`admin-order-deliver`) và "Giao thất bại" (`admin-order-delivery-failed`), cả hai hỏi `confirm`; đơn `failed` hiện ghi chú chờ M6.
  - `OrderView` (trang đơn khách, cả qua token lẫn trong tài khoản): khối `order-shipment` (đơn vị vận chuyển, mã vận đơn `order-tracking-number`, lúc bàn giao) khi có `shipment`; thông báo `delivery-failed` khi giao thất bại. Ba trạng thái đơn, thanh toán, giao hàng đã tách sẵn từ trước.
  - Nhãn sự kiện `delivered`, `delivery_failed`; nhãn audit `order.deliver`, `order.delivery_failed`.
- Smoke không đổi: trang đơn khách không SSR dữ liệu đơn (HTML chỉ có khung "Đang tải"). Chưa xem bằng trình duyệt (ticket 14).
- Test: `api/test/order-delivery.test.ts` (7 test): đã giao thì hoàn tất (sự kiện và audit); giao thất bại thì vẫn xử lý, email một lần; email bàn giao có đơn vị, mã vận đơn, link mở được đơn, đúng một lần; bàn giao lại 409 không gửi thêm thư; sai cạnh 409; `failed` không sang `delivered`; quyền `order.fulfill`.
