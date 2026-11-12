# 03: Đặt mua và giữ hàng

**What to build:**
- Khách đặt mua từ giỏ: nhập thông tin nhận hàng, thấy phí giao và tổng, rồi xác nhận. Hệ thống kiểm lại giá và tồn, tạo đơn, giữ hàng 15 phút, rồi chuyển khách tới trang thanh toán (cổng giả lập khi chạy local).
- Kho có thêm giữ hàng (ADR 0007):
  - "còn hàng" ở mọi chỗ đổi sang tồn trừ số đang giữ;
  - trang Tồn kho có cột "Đang giữ";
  - điều chỉnh tồn xuống dưới số đang giữ bị chặn.
- Khách xem đơn qua link có token, không cần đăng nhập.

Ticket này gộp phần giữ hàng ở kho vào đặt mua, để giữ hàng có đơn thật ngay từ đầu. Đồng ý chính sách bảo mật, thông tin hóa đơn và giới hạn tần suất làm ở ticket 04.

**Blocked by:** 02 (Giỏ hàng)

**Status:** resolved

Kho:
- [x] Biến thể có cột `reserved INTEGER NOT NULL DEFAULT 0`, kèm check `reserved >= 0` và `reserved <= on_hand`
- [x] Module kho có hàm giữ và hàm nhả giữ hàng. Cả hai dùng chung đường khóa với `changeStock`: khóa `FOR UPDATE` theo thứ tự id.
  - Giữ: kiểm `on_hand - reserved >= số lượng` cho từng dòng. Thiếu ở bất kỳ dòng nào thì không giữ dòng nào và trả lỗi theo dòng.
  - Nhả: trừ `reserved`, không ghi sổ xuất nhập.
- [x] "Còn hàng" tính theo `on_hand - reserved > 0` ở mọi chỗ: `inStockIds`, tìm kiếm, sắp xếp còn hàng trước, `availability` của JSON-LD. Cập nhật mục "Snapshot đã xuất bản" trong `CODING_STANDARDS.md` cho khớp ADR 0007
- [x] Trang Tồn kho và API của trang có cột "Đang giữ"
- [x] Điều chỉnh tồn làm `on_hand` mới nhỏ hơn `reserved` thì trả 409, kèm danh sách mã đơn đang giữ biến thể đó. Phiếu nhập không bị ảnh hưởng

Đơn hàng:
- [x] Bảng đơn hàng gồm:
  - id uuid;
  - mã đơn lấy từ sequence riêng, bắt đầu từ 100000;
  - ba trạng thái (đơn hàng, thanh toán, giao hàng) theo spec;
  - snapshot thông tin nhận hàng;
  - phí giao, tổng tiền hàng, tổng phải trả, ghi chú;
  - id các phiên bản chính sách đổi trả/bảo hành gắn với sản phẩm trong đơn;
  - `customer_id` khi khách đã đăng nhập;
  - hash của token tra cứu;
  - thời điểm hết hạn giữ hàng.
- [x] Bảng dòng đơn lưu snapshot: variant id, SKU, tên sản phẩm, thuộc tính biến thể, ảnh đại diện, giá bán, số lượng
- [x] Bảng sự kiện đơn chỉ ghi thêm, trigger chặn sửa và xóa. Mỗi sự kiện có: đơn, loại sự kiện, actor (nhân viên, khách hoặc hệ thống), thời điểm, dữ liệu. Ticket này ghi sự kiện "tạo đơn"
- [x] Interface cổng thanh toán (tạo link, truy vấn theo mã đơn, hủy link), inject vào `createApp` như `Storage` và `EmailQueue`. Có ba bản:
  - Bản giả trong bộ nhớ cho test: ghi lại link đã tạo và đã hủy, trả trạng thái do test đặt, giả lập được lỗi khi tạo link.
  - Cổng giả lập cho local: một trang trên web hiện số tiền và mã đơn. Hai nút giả lập để trống; ticket 05 và 06 sẽ nối vào.
- [x] `POST /api/checkout` chạy trong một transaction:
  1. Kiểm từng dòng: sản phẩm đã xuất bản, biến thể có trong phiên bản đang xuất bản, không ngừng bán, giá bằng giá khách đã thấy, số lượng 1–5.
  2. Có dòng sai thì 409 kèm `details` theo dòng, không ghi gì.
  3. Tính phí giao, tạo đơn, giữ hàng. Thiếu hàng cũng trả 409 theo dòng.
  4. Tạo link thanh toán, thời hạn bằng thời hạn giữ hàng.

  Response trả mã đơn, token tra cứu (chỉ có trong response này), `checkoutUrl` và thời điểm hết hạn.
- [x] Cổng lỗi khi tạo link thì rollback toàn bộ (không có đơn, không giữ hàng) và trả 502 "Chưa tạo được thanh toán, thử lại"
- [x] Chưa cấu hình phí giao mặc định thì trả 503, giống `quote`
- [x] `GET /api/orders/:code?token=…`: token sai hoặc thiếu thì 404, để không lộ đơn có tồn tại hay không
- [x] Web, trang đặt mua:
  - chọn tỉnh/thành và phường/xã, nhập số nhà/đường, tên, số điện thoại, email, ghi chú;
  - gọi `quote` khi mở trang và khi đổi tỉnh/thành;
  - hiện lưu ý khi có món chỉ giao đường bộ;
  - gặp 409 thì hiện thay đổi từng dòng và bắt khách xác nhận lại.
- [x] Web, trang đơn hàng qua token: có đồng hồ đếm thời gian giữ hàng còn lại. Phần hiển thị đơn tách thành component dùng chung `OrderView`, để trang tài khoản (ticket 11) dùng lại
- [x] Trang đặt mua và trang đơn hàng có `noindex`, không SSR dữ liệu cá nhân
- [x] `scripts/smoke.ts` kiểm trang đặt mua có `noindex`
- [x] Có test qua HTTP:
  - đặt mua tạo đơn, giữ hàng và trả link; trang Tồn kho thấy số đang giữ; sản phẩm thành hết hàng khi số giữ bằng tồn;
  - giá đổi, ngừng bán, hết hàng, sản phẩm không còn xuất bản đều trả 409 theo dòng và không ghi gì; quá 5 cái bị từ chối;
  - cổng lỗi thì không có đơn, không giữ hàng;
  - nhiều khách đặt biến thể cuối cùng song song: đúng một đơn được tạo, các đơn khác 409, `reserved` không vượt `on_hand`;
  - snapshot: đổi giá, tên, chính sách sau khi đặt không đổi đơn; đơn lưu đúng phiên bản chính sách; sửa phí giao sau đó không đổi đơn;
  - điều chỉnh tồn xuống dưới số đang giữ trả 409 kèm mã đơn;
  - token sai không xem được đơn;
  - bảng sự kiện đơn không sửa, không xóa được (thử bằng SQL trực tiếp)

**Quyết định khi triển khai (2026-11-02):**
- Migration `20261102000300_orders_reservations`:
  - `product_variant.reserved` với check `reserved >= 0 AND reserved <= on_hand`.
  - Enum `order_status`, `payment_status`, `fulfillment_status` theo spec; enum `order_event_actor` (`staff | customer | system`).
  - Bảng `order` (model Prisma `Order`): `code` INTEGER từ sequence `order_code_seq` (bắt đầu 100000, rollback vẫn tốn số nên mã có thể nhảy), `status`, `payment_status`, `fulfillment_status`, `customer_id` (null), snapshot nhận hàng (`recipient_name`, `phone` dạng `0xxxxxxxxx`, `email` chữ thường, `province_code/name`, `ward_code/name`, `street_address`), `note`, `subtotal`, `shipping_fee`, `total` (BIGINT VND, check `total = subtotal + shipping_fee`), `lookup_token_hash` (unique, SHA-256 như token khách), `reserved_until` (null khi không còn hạn). Index `(status, reserved_until)` cho job hết hạn.
  - Bảng `order_line` (`OrderLine`): `position`, `variant_id`, `sku`, `product_name`, `attributes`, `image` (JSON `StoredImage` + `alt`, null nếu không có), `price` BIGINT, `quantity` (check 1–5).
  - Bảng `order_policy_version` (`OrderPolicyVersion`, khóa `(order_id, page_version_id)`, FK tới `content_page_version`): phiên bản mới nhất lúc đặt của các trang chính sách (`kind = policy`) trong `snapshot.policyPageIds` của mọi sản phẩm trong đơn. Chọn bảng nối thay cho mảng uuid để có FK.
  - Bảng `order_event` (`OrderEvent`): `seq`, `order_id`, `kind` (TEXT), `actor`, `staff_id` (có đúng khi actor `staff`), `customer_id` (chỉ khi actor `customer`), `data` JSONB, `created_at`. Trigger `order_event_append_only` chặn UPDATE/DELETE/TRUNCATE.
- Module kho `api/src/stock/stock.ts`:
  - `reserveStock(tx, [{ variantId, quantity }])` trả `{ ok: true }` hoặc `{ ok: false, shortVariantIds }` (nơi gọi ném 409 để rollback); `releaseStock(tx, lines)` trừ `reserved`, không ghi sổ. Cả hai và `changeStock` dùng chung `lockVariants` (`FOR UPDATE` theo id). `LockedVariant` có thêm `reserved`.
  - `releaseStock` chưa có đường HTTP nào gọi; ticket 06 dùng và test nó.
  - `changeStock` chặn mọi thay đổi âm làm `on_hand` mới < `reserved`: 409 theo `change.path`, `details: { reserved, orderCodes }`. Ticket 08 (bàn giao, loại `sale`) phải trừ `reserved` cùng lúc nên cần mở rộng `changeStock` (ví dụ trường nhả giữ hàng trong `StockChange`) để không vướng chốt này.
  - `ordersHoldingVariant(db, variantId)`: đơn đang giữ = `pending_payment`, hoặc `processing` với giao hàng `not_prepared`/`preparing`.
  - `inStockIds` và thứ tự còn hàng trước trong `api/src/catalog/search.ts` dùng `on_hand - reserved > 0`. JSON-LD `availability` và thẻ sản phẩm đọc `inStock` từ API nên tự theo.
- Module đơn `api/src/orders/orders.ts`: `recordOrderEvent(db, orderId, kind, actor, data)` với `OrderEventKind` (hiện chỉ `'created'`; ticket sau thêm vào union) và `OrderEventActor` (`{ type: 'staff', staffId } | { type: 'customer', customerId? } | { type: 'system' }`); `findOrderByToken(db, code, token)` (404 "Không tìm thấy đơn hàng" cho mã lạ, thiếu hay sai token); `ORDER_VIEW_INCLUDE`, `toPublicOrder(storage, order)`; `orderLookupUrl(siteUrl, code, token)` → `/don-hang/:code?token=…`; `OrderLineImage`.
- Cổng thanh toán `api/src/payments/gateway.ts`: interface `PaymentGateway` (`createLink(PaymentLinkRequest) → { checkoutUrl }`, `getPayment(orderCode) → PaymentInfo { status, amountPaid, transactions[{ reference, amount, paidAt }] }`, `cancelLink(orderCode)`), inject qua `AppDeps.payments`.
  - Test: `createTestApp()` trả `payments` là `InMemoryPaymentGateway` (`created[]`, `cancelled[]`, `payments: Map<orderCode, PaymentInfo>` do test đặt, `failCreate = true` để giả lập lỗi tạo link).
  - Local/smoke/CI: `paymentGatewayFromEnv(env, siteUrl)` hiện luôn trả `SimulatorPaymentGateway`, nên `docker-compose.yml` không cần biến mới. Ticket 12 thêm PayOS khi đủ khóa và chặn khởi động ở production.
  - Link giả lập: `SIMULATOR_PATH = '/thanh-toan-gia-lap'` với query `orderCode`, `amount`, `expiresAt`, `returnUrl`, `cancelUrl`. Cổng giả lập không giữ trạng thái; `getPayment` luôn `pending` (ticket 05 thêm).
- `POST /api/checkout` (router `checkoutRoutes(deps: AppDeps)`, giờ nhận cả `AppDeps`): body `CheckoutRequest` (`lines[{ variantId, quantity, price }]`, `address: ShippingAddress`, `note`). Một `$transaction` (timeout 30 s vì gọi cổng bên trong):
  - kiểm từng dòng, rồi giữ hàng các dòng còn lại, để 409 trả mọi thay đổi trong một lần;
  - 409 `details: CheckoutConflictDetails = { lines: [{ variantId, change: { kind: 'price', from, to } | { kind: 'discontinued' } | { kind: 'out_of_stock' } }] }`, cùng dạng `CartLineChange` của web;
  - `out_of_stock` nghĩa là không đủ số lượng đã chọn, không kèm số còn;
  - phường/xã sai tỉnh thì 400 `address.wardCode`;
  - ghi sự kiện `created` (actor `customer`, `data: { total }`);
  - gọi cổng sau cùng với `description` `DH<mã>`, `returnUrl` = `cancelUrl` = link tra cứu có token, `expiresAt` = `reservedUntil`;
  - cổng lỗi thì 502 `BAD_GATEWAY` (mã lỗi mới trong `ErrorCode`).

  Response 201 `CheckoutResult { code, token, checkoutUrl, reservedUntil }`. `RESERVATION_MINUTES = 15` trong `shared/src/checkout.ts`.
- `GET /api/orders/:code?token=…` (router `publicOrderRoutes`): trả `PublicOrder` (`shared/src/orders.ts`) với `Cache-Control: no-store`. `PublicOrder.policies` là `{ slug, title, version }` của phiên bản đã lưu. Ticket 05 thêm `refresh=1` vào route này.
- Shared mới: `OrderStatus`, `PaymentStatus`, `FulfillmentStatus`, `OrderLineView`, `PublicOrder`, `PhoneNumber`, `ShippingAddress`, `CheckoutLine`, `CheckoutRequest`, `CheckoutLineChange`, `CheckoutConflictDetails`, `CheckoutResult`. `StockItem` có thêm `reserved`.
- `customer_id` chưa được gắn khi khách đã đăng nhập: `POST /api/checkout` chưa đọc phiên khách. Ticket 11 (và 04 cho đồng ý chính sách) thêm xác thực tùy chọn.
- Web:
  - `/dat-mua`: chỉ nạp ở client; phường/xã import động `@ecommerce/shared/wards`. Gọi `quote` khi giỏ nạp xong, khi giỏ đổi và khi đổi tỉnh/thành. Thay đổi từng dòng gộp từ `cartChanges` và `details` của 409. Có nút "Đồng ý giá mới" (`useCart().acceptPrices`) và link "Sửa giỏ hàng". Nút đặt mua khóa khi còn thay đổi. Thành công thì `useCart().clear()` (mới) rồi chuyển tới `checkoutUrl`.
  - `/don-hang/[code]`: đọc `token` từ query, nạp ở client, có `noindex` và `referrer: no-referrer` vì token nằm trong URL.
  - Component `OrderView` (`web/app/components/OrderView.vue`, prop `order: PublicOrder`): ba trạng thái, đồng hồ giữ hàng (`data-testid="reservation-remaining"`), dòng đơn, tiền, địa chỉ, chính sách. Có slot `actions` để ticket 06/11 đặt nút hủy.
  - `/thanh-toan-gia-lap`: hiện mã đơn và số tiền từ query, hai nút để trống (`data-testid` `simulate-paid`, `simulate-expired`), link quay lại chỉ khi `returnUrl` cùng origin.
  - Nhãn trạng thái ở `web/app/utils/orderLabels.ts` (`ORDER_STATUS_LABELS`, `PAYMENT_STATUS_LABELS`, `FULFILLMENT_STATUS_LABELS`, `variantAttributesText`; trang giỏ dùng lại hàm này). Trang Tồn kho admin có cột "Đang giữ".
- Smoke thêm `/dat-mua`, `/don-hang/100000?token=sai` và `/thanh-toan-gia-lap?…` (khung trang, `noindex`). Đã xem SSR ba trang bằng `nuxt dev`; chưa đi luồng đặt mua bằng trình duyệt (ticket 14).
- Test: `api/test/checkout.test.ts` (16 test), helper `api/test/support/shop.ts` (`shop()`: cửa hàng có phí giao, sản phẩm đã xuất bản gắn trang chính sách, `checkout(body)`, `editVariant`).
- Cần chủ doanh nghiệp xác nhận: `returnUrl` gửi cổng thanh toán chứa token tra cứu, nên PayOS thấy link tra cứu đơn. Chọn vậy để khách quay về thấy ngay đơn mà không cần đăng nhập.
