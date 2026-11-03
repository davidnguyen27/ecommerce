# 11: Đơn hàng trong tài khoản khách

**What to build:**
- Khách đã đăng nhập thấy lịch sử mua và chi tiết từng đơn trong trang tài khoản.
- Đơn vãng lai cùng email tự gắn vào tài khoản sau khi khách xác minh email.
- Form đặt mua tự điền địa chỉ khách đã dùng lần trước.

**Blocked by:** 03 (Đặt mua và giữ hàng)

**Status:** resolved

- [x] Khách đã đăng nhập đặt mua thì đơn gắn `customer_id`, và địa chỉ lần trước trên khách hàng được ghi đè (chỉ một bản, chỉ khi đặt mua thành công)
- [x] Xác minh email thành công thì các đơn chưa có `customer_id` và cùng email (so chữ thường) được gắn vào khách đó, trong cùng transaction. Email chưa xác minh thì không gắn
- [x] `GET /api/account/orders` (có phân trang) và `GET /api/account/orders/:code`. Đơn của người khác trả 404
- [x] API trả địa chỉ lần trước cho trang đặt mua, và trang đặt mua tự điền khi có
- [x] Web: mục "Đơn hàng của tôi" trong trang tài khoản; trang chi tiết dùng lại `OrderView`. Nếu ticket 06 đã xong thì gắn nút hủy gọi `POST /api/account/orders/:code/cancel` (06 chưa merge lúc xong ticket này: xem quyết định bên dưới)
- [x] Có test qua HTTP:
  - đơn của khách đăng nhập hiện trong lịch sử;
  - đơn vãng lai chỉ gắn vào tài khoản sau khi xác minh email;
  - không thấy đơn của người khác;
  - địa chỉ lần trước được trả về, và được cập nhật sau đơn mới

**Quyết định khi triển khai (2026-11-02):**
- Migration `20261102001100_customer_last_address`: cột `customer.last_shipping_address` JSONB (Prisma `Customer.lastShippingAddress`), dạng `ShippingAddress` (`recipientName`, `phone`, `email`, `provinceCode`, `wardCode`, `streetAddress`; không lưu tên tỉnh/phường vì suy được từ mã). `POST /api/checkout` ghi đè cột này trong cùng transaction đặt mua khi khách đã đăng nhập, nên đặt hỏng (409, 429, cổng lỗi…) thì địa chỉ cũ giữ nguyên.
- `GET /api/account/shipping-address` (trong `accountRoutes`) trả `LastShippingAddress` `{ address: ShippingAddress | null }` (`shared/src/checkout.ts`), `Cache-Control: no-store`. JSON lưu không hợp lệ thì coi như `null`.
- Router mới `accountOrderRoutes({ prisma, storage })` ở `api/src/routes/account-orders.ts`, gắn `api.use('/account/orders', requireAuth(secret, 'customer'), …)` trong `app.ts` (trước `/account`):
  - `GET /api/account/orders`: query `AccountOrderQuery` (`page`, `pageSize` mặc định 20, tối đa 100), trả `AccountOrderPage` = `pageOf(AccountOrderSummary)` (`code`, `status`, `paymentStatus`, `fulfillmentStatus`, `createdAt`, `total`, `itemCount` = tổng số lượng), mới nhất trước (theo `code` giảm dần).
  - `GET /api/account/orders/:code`: `PublicOrder` qua `findCustomerOrder(db, code, customerId)` (`api/src/orders/orders.ts`); mã lạ hay đơn của người khác đều 404 "Không tìm thấy đơn hàng".
  - Cả hai `Cache-Control: no-store`.
  - Ticket 06 cũng tạo `api/src/routes/account-orders.ts` (route hủy): khi merge, gộp cả ba route vào một router; route hủy có thể dùng lại `findCustomerOrder`.
- Gắn đơn vãng lai: `verifyEmail` (`api/src/customers/email-verification.ts`), trong transaction dùng token, `order.updateMany({ customerId: null, email: customer.email })`. Email trên đơn và trên khách đều đã lưu chữ thường. Chỉ gắn lúc xác minh: đơn vãng lai đặt bằng email đó sau khi đã xác minh thì không tự gắn (cần đăng nhập khi đặt). Không ghi sự kiện đơn cho việc gắn, vì không đổi trạng thái đơn.
- Web:
  - `pages/tai-khoan.vue` chuyển thành `pages/tai-khoan/index.vue`; thêm component `AccountOrders` (mục "Đơn hàng của tôi", phân trang trước/sau, `data-testid` `account-order`, `account-orders-empty`).
  - Trang chi tiết `/tai-khoan/don-hang/[code]`: nạp ở client qua `accountFetch`, chưa đăng nhập thì về `/dang-nhap`, dùng `OrderView`, `noindex`. Smoke thêm khung trang này.
  - `OrderView` hiện khối "Xuất hóa đơn công ty" (`data-testid="order-invoice"`) khi `order.invoice` khác `null`; hiện ở cả trang đơn qua token.
  - `/dat-mua`: khách đã đăng nhập thì gọi `/api/account/shipping-address` và điền sẵn, chỉ khi khách chưa gõ gì vào form; phường/xã điền sau `nextTick` vì watcher tỉnh/thành xóa phường/xã.
- **Nút hủy chưa gắn:** ticket 06 (`ticket/m3-06-het-han-huy`) chưa merge vào `spec/m3-mua-hang` lúc xong ticket này. Ticket 06 (hoặc người merge) đặt nút hủy vào slot `actions` của `OrderView` trên `/tai-khoan/don-hang/[code].vue`, gọi `POST /api/account/orders/:code/cancel` qua `session.accountFetch`, rồi nạp lại đơn.
- `checkout-guards.test.ts`: test khách đã đăng nhập giờ kiểm đơn gắn tài khoản qua `GET /api/account/orders/:code` thay vì prisma.
- Test: `api/test/account-orders.test.ts` (5 test). Chưa xem các trang mới bằng trình duyệt (ticket 14).
- Cần chủ doanh nghiệp xác nhận: đơn vãng lai cùng email được gắn vào tài khoản ngay khi xác minh email, khách không được hỏi trước; đơn vãng lai đặt sau khi đã xác minh thì không tự gắn.
