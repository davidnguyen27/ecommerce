# 08: Chuẩn bị và bàn giao vận chuyển

**What to build:**
- Nhân viên kho đánh dấu đơn đang chuẩn bị, rồi ghi bàn giao vận chuyển với đơn vị vận chuyển và mã vận đơn.
- Hàng rời tồn lúc bàn giao (ADR 0007): trừ cả tồn và số đang giữ, sổ xuất nhập ghi dòng xuất bán có tham chiếu tới đơn.

**Blocked by:** 07 (Đơn hàng ở trang quản trị)

**Status:** resolved

- [x] Sổ xuất nhập có loại mới `sale` và cột `order_id`, kèm check: dòng loại `sale` bắt buộc có đơn. Trang Sổ xuất nhập hiện loại "Xuất bán" kèm link tới đơn
- [x] Hai chuyển trạng thái `not_prepared` → `preparing` và `preparing` → `handed_over`:
  - cần quyền `order.fulfill`, đi qua `audited()`;
  - chỉ làm được khi thanh toán đã `paid`;
  - sai cạnh trạng thái thì 409.
- [x] Bàn giao bắt buộc có `carrier` và `trackingNumber`. Trong một transaction:
  1. khóa các biến thể theo thứ tự id;
  2. trừ `on_hand` và `reserved`;
  3. ghi một dòng sổ `sale` cho mỗi dòng đơn.
- [x] Trang chi tiết đơn có nút chuẩn bị và form bàn giao
- [x] Có test qua HTTP:
  - chuẩn bị rồi bàn giao: `on_hand` và `reserved` cùng giảm, sổ có dòng `sale` tham chiếu tới đơn;
  - bàn giao thiếu mã vận đơn thì 400 theo trường;
  - sai cạnh trạng thái thì 409;
  - đơn chưa trả tiền không chuẩn bị được;
  - thiếu `order.fulfill` thì 403;
  - mỗi thao tác đều ghi audit

**Quyết định khi triển khai (2026-11-02):**
- Migration `20261102000800_order_handover`:
  - `stock_movement_kind` thêm `sale`; cột `stock_movement.order_id` (FK `order`, index), check `stock_movement_order_check`: `(kind = 'sale') = (order_id IS NOT NULL)` (so theo `kind::text` vì giá trị enum mới chưa dùng được trong cùng transaction migration).
  - Cột `order.carrier`, `order.tracking_number`, `order.handed_over_at`; check `order_handover_check`: có đủ cả ba khi và chỉ khi `fulfillment_status` là `handed_over`, `delivered` hoặc `failed`. Ticket 09 chỉ đổi `fulfillment_status` sang `delivered`/`failed`, giữ nguyên ba cột. Dựng đơn đã bàn giao bằng prisma phải đặt cả ba.
- Module kho: `StockChange` thêm `orderId` (dòng sổ `sale`) và `releaseReserved` (số giữ nhả cùng lúc). `changeStock` tính chốt "tồn không thấp hơn số đang giữ" trên số giữ còn lại sau khi nhả, và cập nhật `on_hand` cùng `reserved` trong một lệnh. Vẫn một đường khóa `lockVariants` (ADR 0007); `reserveStock`/`releaseStock` không đổi.
- Module `api/src/orders/fulfill-order.ts`: `prepareOrder(tx, orderId, staffId)` và `handOverOrder(tx, orderId, staffId, HandoverRequest)`, gọi trong transaction của `audited()`. Cả hai khóa đơn `FOR UPDATE` (cùng khóa với hủy đơn, ghi nhận thanh toán); đơn không phải `processing` + `paid` (chưa trả, đã hủy) thì 409 "Đơn chưa thanh toán đủ…"; sai trạng thái giao hàng thì 409. Bàn giao: `changeStock` mỗi dòng đơn `quantity: -q, releaseReserved: q, kind: 'sale', orderId`, rồi đặt `handed_over` + ba cột, ghi sự kiện.
  - **Ticket 09:** chỗ xếp email "đã bàn giao vận chuyển" là cuối `handOverOrder` (có comment đánh dấu), trong cùng transaction; cần thêm tham số hàng đợi email cho hàm.
- `OrderEventKind` thêm `preparing` (data `{}`) và `handed_over` (data `{ carrier, trackingNumber }`), actor staff. Audit `order.prepare` (`before/after { fulfillmentStatus }`) và `order.hand_over` (`after` thêm `carrier`, `trackingNumber`), entity `order`, nên tự hiện trong lịch sử thao tác.
- Route (`admin-orders.ts`, cả hai cần `order.fulfill`, trả `AdminOrder` 200 qua `loadAdminOrder`; mã lạ 404):
  - `POST /api/admin/orders/:code/prepare`;
  - `POST /api/admin/orders/:code/hand-over` body `HandoverRequest { carrier, trackingNumber }` (trim, 1–100 ký tự), thiếu thì 400 theo trường.
  - Helper `findOrder(code)` trong router; route hủy đơn dùng lại.
- Shared: `HandoverRequest`; `PublicOrder.shipment: { carrier, trackingNumber, handedOverAt } | null` (nên `AdminOrder` cũng có; trang khách chưa hiện, ticket 09 hiện mã vận đơn); `StockMovementKind` thêm `sale`; `StockMovement.orderCode` (null trừ dòng `sale`).
- Web: component `AdminFulfillmentPanel` (`web/app/components/AdminFulfillmentPanel.vue`, prop `order`, `canFulfill`; emit `update` với response, `reload` khi lỗi không theo trường) ở đầu cột phải trang chi tiết đơn (`admin-order-fulfillment`), hiện khi đơn `processing` + `paid` hoặc đã có `shipment`. Nút "Bắt đầu chuẩn bị" (`admin-order-prepare`), form bàn giao (`admin-order-handover`), thông tin bàn giao (`admin-order-shipment`). Ticket 09 thêm nút "Đã giao"/"Giao thất bại" vào panel này. Nhãn sự kiện `preparing`, `handed_over` trong `ORDER_EVENT_LABELS`; lịch sử hiện đơn vị + mã vận đơn của sự kiện bàn giao; nhãn audit `order.prepare`, `order.hand_over`. Sổ xuất nhập: nhãn "Xuất bán" và link "đơn #mã".
- Smoke không đổi (chỉ trang admin SPA). Chưa xem panel bằng trình duyệt (ticket 14).
- Test: `api/test/order-fulfillment.test.ts` (7 test), gồm cả kiểm kê hạ tồn về 0 được sau khi bàn giao (đơn không còn giữ hàng).
- Không có quyết định cần chủ doanh nghiệp xác nhận.
