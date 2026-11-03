# 07: Đơn hàng ở trang quản trị

**What to build:**
- Nhân viên xem danh sách đơn, lọc theo ba trạng thái, tìm theo mã đơn, số điện thoại hoặc email.
- Chi tiết đơn có lịch sử thao tác (ai làm gì, lúc nào), thông tin xuất hóa đơn và các giao dịch thanh toán. Phiếu soạn hàng in được.
- Nhân viên hủy đơn chưa thanh toán từ trang chi tiết.

**Blocked by:** 06 (Hết hạn và hủy đơn chưa thanh toán)

**Status:** resolved

- [x] Thêm hai quyền mới vào shared và seed vai trò:
  - `order.view`: owner, sales, warehouse, accountant;
  - `order.fulfill`: owner, warehouse.
- [x] API danh sách đơn:
  - lọc theo trạng thái đơn hàng, thanh toán, giao hàng;
  - tìm theo mã đơn, số điện thoại, email;
  - phân trang bằng `PageQuery`;
  - mặc định hiện đơn đã trả đủ đang chờ soạn, đơn cũ trước.
- [x] API chi tiết đơn trả: dòng đơn, thông tin nhận hàng, thông tin hóa đơn, giao dịch thanh toán, và lịch sử thao tác (sự kiện đơn gộp với audit theo thời gian, actor có tên)
- [x] Web:
  - menu "Đơn hàng" trong `ADMIN_MENU_GROUPS`, quyền `order.view`;
  - trang danh sách và trang chi tiết;
  - nút hủy đơn chưa thanh toán, chỉ hiện với `order.fulfill`;
  - phiếu soạn hàng in bằng CSS print: SKU, tên sản phẩm, thuộc tính, số lượng, địa chỉ nhận, mã đơn.
- [x] Có test qua HTTP:
  - thiếu `order.view` thì 403;
  - lọc và tìm cho kết quả đúng;
  - chi tiết có lịch sử với đủ ba loại actor: khách, hệ thống, nhân viên;
  - thông tin hóa đơn hiện ở chi tiết

**Ghi chú:** ticket này phụ thuộc 06 chứ không chỉ 05, vì nút hủy của nhân viên dùng hàm hủy đơn của 06, và lịch sử thao tác cần có đủ sự kiện hủy và hết hạn.

**Quyết định khi triển khai (2026-11-02):**
- Quyền: `order.view` mới trong `Permission` (shared) và `ROLE_PERMISSIONS` (`api/src/auth/permissions.ts`) cho owner, sales, warehouse, accountant. `order.fulfill` đã có từ ticket 06. Không có bảng vai trò trong DB nên "seed" là map trong code.
- **Lệch so với ticket:** test "thiếu `order.view` thì 403" không viết được qua HTTP vì mọi vai trò đều có `order.view`. Thay bằng test `/me` của từng vai trò (sales, accountant chỉ `order.view`; warehouse có cả `order.fulfill`). `requirePermission('order.view')` vẫn gắn trên cả hai route GET; 403 chung đã có test ở `staff-management.test.ts`.
- Không cần migration.
- `GET /api/admin/orders` (`order.view`), query `AdminOrderQuery` (`shared/src/orders.ts`):
  - `status`, `paymentStatus`, `fulfillmentStatus`: một giá trị enum hoặc `all`; mặc định `processing` / `paid` / `not_prepared` (hàng chờ soạn).
  - `q`: mã đơn khớp đúng, số điện thoại chứa chuỗi đã gõ (bỏ dấu cách, chấm, gạch; `+84`/`84` đổi thành `0`), hoặc email chứa chuỗi (chữ thường). Bộ lọc trạng thái vẫn áp khi tìm, nên web có nút "Mọi đơn".
  - `sort`: `oldest` (mặc định) hoặc `newest`, theo `code`.
  - `page`, `pageSize` từ `PageQuery`. Trả `AdminOrderPage` = `pageOf(AdminOrderSummary)` (`AccountOrderSummary` thêm `recipientName`, `phone`, `email`, `provinceName`).
- `GET /api/admin/orders/:code` (`order.view`) trả `AdminOrder` = `PublicOrder` + `customerId`, `payments: AdminPaymentTransaction[]` (`id`, `amount`, `reference`, `paidAt`, `source`, `reconciliation: { reason, status } | null`; không trả `payload` gốc), `history: OrderHistoryEntry[]`. Mã lạ 404.
  - Dựng bằng `loadAdminOrder(db, storage, code)` ở `api/src/orders/admin-order.ts`. **Ticket 08, 09:** route đổi trạng thái giao hàng trả `AdminOrder` qua hàm này (200) để trang thay đơn đang hiện. Ticket 10 thêm trường đối soát chi tiết vào `AdminOrder` ở đây nếu cần.
  - `OrderHistoryEntry` = `{ source: 'event' | 'audit', action, actor, data, at }`, cũ trước. `event`: `action` là `OrderEventKind`, `data` là `order_event.data`. `audit`: bản ghi `audit_log` có `entity_type = 'order'` và `entity_id = order.id`, `action` như `order.cancel`, `data = { before, after }`. Hai nguồn trùng thời điểm (cùng transaction) thì sự kiện đứng trước. Ticket 08, 09 ghi audit với `entityType: 'order'`, `entityId: order.id` thì tự hiện ở đây.
  - `OrderHistoryActor`: `{ type: 'staff', id, name, email }`, `{ type: 'customer', id, email }` (cả hai `null` khi khách dùng link tra cứu), `{ type: 'system' }`. Khách không có tên trong DB nên hiện bằng email tài khoản.
  - Nhân viên hủy đơn hiện hai dòng: sự kiện `cancelled` (actor staff) và audit `order.cancel`. Giữ cả hai vì ticket yêu cầu gộp, chưa khử trùng.
- `adminOrderRoutes(prisma, storage, payments)` (thêm `storage`).
- Shared mới: `AdminOrderQuery`, `AdminOrderSummary`, `AdminOrderPage`, `PaymentSource`, `ReconciliationReason`, `AdminPaymentTransaction`, `OrderHistoryActor`, `OrderHistoryEntry`, `AdminOrder`.
- Web:
  - Menu "Đơn hàng" (`/admin/orders`, icon `ShoppingBag`, quyền `order.view`) đứng đầu nhóm "Bán hàng".
  - `/admin/orders`: ô tìm, ba bộ lọc trạng thái (có "Tất cả"), thứ tự; nút "Hàng chờ soạn" và "Mọi đơn" (mọi trạng thái, mới trước). Dòng `data-testid="admin-order-row"`.
  - `/admin/orders/[code]`: layout `admin-two-col`. Cột trái: dòng đơn + tiền, "Giao dịch thanh toán" (`admin-order-payment`), "Lịch sử thao tác" (`admin-order-history`). Cột phải: "Trạng thái" (`admin-order-status`), "Nhận hàng", "Xuất hóa đơn công ty" (`admin-order-invoice`), "Chính sách lúc đặt". Nút "Hủy đơn" (`admin-order-cancel`) chỉ khi `session.can('order.fulfill')` và đơn `pending_payment`, hỏi `confirm`, rồi nạp lại đơn (cả khi lỗi).
  - **Cách ticket 08, 09, 10 thêm UI:** thêm một `admin-panel` (nên là component riêng nhận prop `order: AdminOrder`, emit đơn mới) vào đầu cột phải cho xử lý giao hàng (08, 09), hoặc sau "Giao dịch thanh toán" ở cột trái cho đối soát (10). Trang có `setOrder(value)` (parse `AdminOrder`) để nhận response của route xử lý, và `load()` khi route trả 204. Kiểm quyền bằng `canFulfill` có sẵn.
  - Phiếu soạn hàng: phần `admin-print-only` (`data-testid="pick-slip"`) cuối trang chi tiết, nút "In phiếu soạn hàng" gọi `window.print()`. Có mã đơn, ngày đặt, người nhận, số điện thoại, địa chỉ, ghi chú, bảng SKU / sản phẩm / thuộc tính / SL / ô "Đã soạn", tổng số món. Không in giá. CSS in chung trong `admin.css`: `.admin-print-only` (chỉ hiện khi in) và `.admin-no-print`; khi in ẩn sidebar, topbar.
  - Nhãn mới ở `web/app/utils/orderLabels.ts`: `CANCEL_REASON_LABELS`, `orderEventLabel` (ticket 08, 09 thêm loại sự kiện mới vào `ORDER_EVENT_LABELS`), `PAYMENT_SOURCE_LABELS`, `RECONCILIATION_REASON_LABELS`.
- Smoke không đổi: chỉ thêm trang admin (SPA). Chưa xem hai trang bằng trình duyệt và chưa in thử (ticket 14).
- Test: `api/test/admin-orders.test.ts` (6 test). `staff-management.test.ts` cập nhật quyền của warehouse.
- Cần chủ doanh nghiệp xác nhận: sales và accountant xem được toàn bộ đơn, gồm số điện thoại, email, địa chỉ khách (theo ticket); phiếu soạn hàng không in giá.
