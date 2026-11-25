# 04: Đồng ý chính sách, thông tin hóa đơn, giới hạn tần suất

**What to build:**
- Khách vãng lai phải tick đồng ý chính sách bảo mật trước khi đặt mua. Lần đồng ý được ghi kèm phiên bản chính sách.
- Khách mua bằng tiền công ty nhập được tên công ty, mã số thuế và địa chỉ xuất hóa đơn.
- Trang đặt mua hiện link chính sách đổi trả và bảo hành áp dụng cho các món trong đơn.
- Đặt mua bị giới hạn tần suất, để không ai giữ hàng ác ý được.

**Blocked by:** 03 (Đặt mua và giữ hàng)

**Status:** resolved

- [x] `POST /api/checkout` nhận cờ đồng ý chính sách bảo mật. Khách vãng lai thiếu cờ thì 400 theo trường. Lần đồng ý được ghi kèm phiên bản chính sách, theo cơ chế đã có ở đăng ký khách (ticket 05 của M0–M1)
- [x] Thông tin xuất hóa đơn công ty là tùy chọn (tên, mã số thuế, địa chỉ) và lưu snapshot trên đơn.
  - Nhập thiếu trường nào thì báo theo trường đó.
  - Mã số thuế: 10 số, hoặc 13 số có gạch nối trước 3 số cuối.
- [x] Trang đặt mua có thêm:
  - checkbox đồng ý kèm link chính sách bảo mật, ẩn khi khách đã đăng nhập;
  - phần "Xuất hóa đơn công ty", thu gọn mặc định;
  - danh sách link chính sách đổi trả và bảo hành đang áp dụng cho các món, lấy từ `quote` hoặc từ phiên bản chính sách đã xuất bản.
- [x] Giới hạn tần suất bằng `enforceRateLimits`:
  - 5 lần đặt mua mỗi giờ cho mỗi IP (bộ đếm cửa sổ);
  - tối đa 3 đơn đang `pending_payment` cho mỗi email (so chữ thường) và mỗi số điện thoại (đếm trong DB).

  Vượt giới hạn thì trả 429 kèm thông báo rõ.
- [x] Có test qua HTTP:
  - khách vãng lai thiếu đồng ý bị từ chối, khách đã đăng nhập không cần;
  - thông tin hóa đơn được lưu đúng, thiếu trường bị từ chối;
  - vượt giới hạn theo IP trả 429;
  - email đã có 3 đơn chờ thì đơn thứ tư bị 429; sau khi một đơn hết hạn hoặc được thanh toán thì đặt được lại

**Ghi chú:** các con số giới hạn đang là tạm, chờ chủ doanh nghiệp xác nhận (spec "Further Notes").

**Quyết định khi triển khai (2026-11-02):**
- Đăng nhập tùy chọn: middleware `optionalAuth(secret, audience)` trong `api/src/auth/require-auth.ts`. Không có header `Authorization` thì cho qua như khách vãng lai; có header thì token phải hợp lệ, sai hay hết hạn thì 401 (không âm thầm coi là khách vãng lai). Route đọc `req.auth?.subjectId`. `POST /api/checkout` dùng nó và ghi `order.customer_id`; sự kiện `created` có `customerId` khi khách đã đăng nhập. Ticket 11 lọc đơn trong tài khoản theo `order.customer_id`. `POST /quote` không đọc phiên.
- Web: `useCustomerSession()` có thêm `signedIn()` (thử refresh, không ném lỗi) và `optionalAuthFetch(path, options)` (đã đăng nhập thì kèm access token). Trang `/dat-mua` gửi đặt mua qua `optionalAuthFetch`. Gặp 401 thì trang chuyển sang hiện ô đồng ý.
- Migration `20261102000400_checkout_consent_invoice`:
  - `order.privacy_policy_version_id` (FK `content_page_version`): phiên bản chính sách bảo mật hiện hành lúc đặt của khách vãng lai, đọc bằng `findCurrentPrivacyPolicy` trong transaction đặt mua. Thời điểm đồng ý là `created_at` của đơn. Check `customer_id IS NOT NULL OR privacy_policy_version_id IS NOT NULL`.
  - Khách đã đăng nhập không ghi lời đồng ý trên đơn, vì đã đồng ý lúc đăng ký (`customer_consent`). Chọn cột trên đơn thay vì `customer_consent` vì bảng đó cần khách có tài khoản.
  - Chưa xuất bản chính sách bảo mật thì khách vãng lai nhận 503 "Chưa thể đặt mua vì chính sách bảo mật chưa được công bố", như đăng ký.
  - `invoice_company_name`, `invoice_tax_code`, `invoice_address`: có đủ cả ba hoặc không có gì (check constraint).
  - Index `(email, status)` và `(phone, status)` để đếm đơn chờ.
- Shared: `CheckoutRequest` có thêm `acceptPrivacyPolicy` (boolean tùy chọn, khách vãng lai thiếu hay `false` thì 400 trường `acceptPrivacyPolicy`) và `invoice: InvoiceInfo` (`companyName`, `taxCode`, `address`). Schema `TaxCode` nhận `^\d{10}(-\d{3})?$`. `PublicOrder` có thêm `privacyConsent: { policyVersion, consentedAt } | null` và `invoice | null`. `CheckoutQuote` có thêm `policies: [{ slug, title }]`: chính sách đổi trả, bảo hành đang xuất bản của các sản phẩm còn bán trong giỏ, sắp theo slug (dùng chung hàm `livePolicyVersions` với lúc tạo đơn).
- Giới hạn tần suất:
  - Theo IP: `RATE_LIMITS.checkoutPerIp` (5 lần/giờ) qua `enforceRateLimits`, tính sau khi body hợp lệ, nên lỗi 400 không tính còn 409 (giỏ đã đổi) có tính. `enforceRateLimits` nhận thêm tham số `message`; đặt mua dùng "Bạn đã đặt mua quá nhiều lần, vui lòng thử lại sau".
  - Theo email và số điện thoại: `enforcePendingOrderLimit(tx, res, { email, phone })` trong `api/src/checkout/pending-orders.ts`, hằng `MAX_PENDING_ORDERS_PER_CONTACT = 3`. Chạy trong transaction đặt mua, sau `pg_advisory_xact_lock` theo email rồi theo số điện thoại, nên các lần đặt song song không vượt giới hạn. Chỉ đếm đơn `pending_payment` còn `reserved_until > now()`, nên đơn quá hạn mà job (ticket 06) chưa kịp hủy không bị tính. Vượt thì 429 `RATE_LIMITED` kèm `fields` `address.email` hoặc `address.phone`, và `Retry-After` là lúc đơn sớm nhất hết hạn.
- Web `/dat-mua`: ô đồng ý kèm link chính sách bảo mật, chỉ hiện khi chưa đăng nhập. Phần "Xuất hóa đơn công ty" là `<details>` thu gọn, tự mở khi server báo lỗi ở trường của nó; bỏ trống cả ba thì không gửi. Danh sách link chính sách lấy từ `quote.policies`. Nút đặt mua khóa cho tới khi biết khách đã đăng nhập hay chưa. Smoke không đổi: các phần mới chỉ render ở client.
- `OrderView` chưa hiện thông tin hóa đơn công ty. Để ticket 07 hoặc 11 thêm, vì ticket 05 đang sửa phần đơn hàng.
- Test: `api/test/checkout-guards.test.ts`. `shop()` giờ xuất bản chính sách bảo mật và `checkout()` mặc định gửi `acceptPrivacyPolicy: true`. Test đặt nhiều đơn trong một app cần đổi `X-Forwarded-For` (quá 5 lần/IP) và email/số điện thoại (quá 3 đơn chờ). Test "đặt được lại" dựng trạng thái đã thanh toán, đã hết hạn bằng prisma, vì đường HTTP của ticket 05/06 chưa có trên nhánh này. Test khách đã đăng nhập đọc `customer_id` bằng prisma, vì chưa có API đơn trong tài khoản.
- Chưa xem trang `/dat-mua` bằng trình duyệt (ticket 14).
- Cần chủ doanh nghiệp xác nhận: các con số 5 lần/giờ/IP và 3 đơn chờ cho mỗi email, mỗi số điện thoại; việc lần đặt mua bị 409 (giỏ đã đổi) cũng tính vào giới hạn theo IP.
