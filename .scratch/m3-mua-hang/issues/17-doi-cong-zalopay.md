# 17: Đổi cổng thanh toán từ PayOS sang ZaloPay

> Đã được thay bằng ticket 18 (VNPAY, ADR 0010), ngày 2026-11-11. Giữ lại làm lịch sử.

**What to build:**
- Bản cài đặt ZaloPay của interface cổng thanh toán thay cho PayOS (ADR 0009), chạy được ngay khi có khóa sandbox hoặc khóa thật. Bỏ hẳn code PayOS.
- Callback của ZaloPay ghi nhận thanh toán qua `recordPayment`, như webhook PayOS trước đây.
- Job hết hạn hỏi cổng trước khi hủy đơn quá hạn.
- Tài liệu dự án nói về ZaloPay thay cho PayOS.

**Blocked by:** 12 (Cổng PayOS thật). Thay phần cổng thật của ticket 12.

**Status:** resolved

Sự kiện về ZaloPay (đọc 2026-11-09, `https://developers.zalopay.vn/v2/general/overview.html` và repo mẫu chính thức `https://github.com/zalopay-samples/quickstart-payment-gateway`):
- Host: sandbox `https://sb-openapi.zalopay.vn`, thật `https://openapi.zalopay.vn`.
- Tạo đơn `POST /v2/create`, các trường `app_id, app_trans_id, app_user, app_time` (ms), `amount, item` (chuỗi JSON), `embed_data` (chuỗi JSON, có `redirecturl`), `description, bank_code, callback_url, expire_duration_seconds, mac`; trả `order_url`. `mac` = HMAC-SHA256 (hex) bằng key1 trên `app_id|app_trans_id|app_user|amount|app_time|embed_data|item`.
- `app_trans_id`: tối đa 40 ký tự, bắt đầu bằng `yymmdd` của ngày hiện tại theo GMT+7, trùng thì lỗi `sub_return_code` -68. `expire_duration_seconds`: 300 đến 2592000.
- Callback: body `{ data, mac, type }`, `data` là chuỗi JSON; `mac` = HMAC-SHA256 bằng key2 trên chuỗi `data`. `data` có `app_id, app_trans_id, app_time, app_user, amount, embed_data, item, zp_trans_id, server_time, channel, merchant_user_id, user_fee_amount, discount_amount`. Trả `{ return_code, return_message }`: `1` thành công, `-1` sai MAC, `0` để ZaloPay gửi lại.
- Truy vấn `POST /v2/query`, `mac` bằng key1 trên `app_id|app_trans_id|key1`; `return_code` `1` đã trả, `2` thất bại, `3` chưa trả hoặc đang xử lý. Merchant phải tự truy vấn nếu không có callback.
- Không có API hủy đơn. Có `/v2/refund` (chưa dùng ở M3).
- Chưa xác minh, để ticket 16 kiểm trên sandbox: request gửi dạng form hay query string (mẫu dùng query string với body rỗng); tên trường đầy đủ của response truy vấn (`zp_trans_id`, `amount`, `server_time`?); `amount` của callback có bao gồm `discount_amount`/`user_fee_amount` không; callback có đến cho đơn đã hết hạn không.

Code:
- [x] `api/src/payments/zalopay.ts`: `ZaloPayPaymentGateway` theo khuôn `PayosPaymentGateway` cũ (inject `fetch`, `baseUrl`; timeout 15 giây; mọi lỗi thành `PaymentGatewayError`; không tự thử lại). Hàm thuần `zalopayMac`, `isValidZaloPayCallback` (so sánh thời gian hằng), `appTransId(orderCode, now)` theo ngày GMT+7, `orderCodeFromAppTransId`. `app_user` là mã đơn, không gửi email hay số điện thoại khách. `bank_code` rỗng để khách tự chọn cách trả. `cancelLink` không làm gì, comment nêu lý do (ADR 0009)
- [x] Xóa `api/src/payments/payos.ts`, `api/test/payos-gateway.test.ts`, `api/test/support/payos.ts`, `docs/payos.md`
- [x] Interface trong `api/src/payments/gateway.ts`: `createLink` trả `{ checkoutUrl, gatewayReference }`; `getPayment(gatewayReference)`; `cancelLink(gatewayReference)`. Bản trong bộ nhớ và cổng giả lập dùng `String(orderCode)` làm mã. Bỏ các comment và trạng thái chỉ PayOS mới có
- [x] Migration `20261109001700_order_gateway_reference`: cột `order.gateway_reference` TEXT unique, cho phép null; `schema.prisma` đồng bộ. Đặt mua lưu mã này; `refresh=1`, hủy đơn và job hết hạn đọc mã này (đơn không có mã thì bỏ qua bước gọi cổng)
- [x] `api/src/payments/gateway-from-env.ts`: `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2`, `ZALOPAY_ENV` (`production` mặc định hoặc `sandbox`); đặt thiếu khóa thì ném; production thiếu khóa thì dừng như cũ; `NODE_ENV=production` với `ZALOPAY_ENV=sandbox` cũng dừng, trừ khi có `PAYMENT_SIMULATOR=allow`
- [x] `POST /api/payments/zalopay/callback` thay `/payos/webhook`: chỉ mở khi đang dùng ZaloPay; kiểm MAC trên chuỗi `data` gốc trước khi parse; parse bằng schema shared; gọi `recordPayment` với `reference` = `zp_trans_id`, `amount`, `paidAt` = `server_time`, nguồn `webhook`. Luôn HTTP 200 với body có kiểu shared: sai MAC `-1`, ghi nhận xong hay đã ghi trước `1`, lỗi bất ngờ `0`
- [x] Hủy đơn vì hết hạn (job hẹn giờ, job quét, nút giả lập hết hạn): hỏi cổng trước; đã trả thì ghi nhận qua `recordPayment` (nguồn `query`) và không hủy; cổng lỗi thì log rồi vẫn hủy. Khách hoặc nhân viên hủy thì không hỏi cổng
- [x] Đặt mua: `description` là "Thanh toán đơn hàng #<mã>"; `expire_duration_seconds` khớp hạn giữ hàng
- [x] `AppDeps.payosChecksumKey` đổi thành khóa callback ZaloPay; `server.ts`, `test-app.ts` theo đó
- [x] `.env.example`, `docker-compose.yml`, `scripts/smoke.ts`: biến `ZALOPAY_*` thay `PAYOS_*`; smoke vẫn xóa khóa để luôn dùng cổng giả lập
- [x] Web: `dat-mua.vue` đổi câu "Thanh toán bằng chuyển khoản qua mã VietQR" thành thanh toán qua ZaloPay; `thanh-toan-gia-lap.vue` đổi chữ "khóa PayOS"

Test (HTTP thật, cổng giả):
- [x] `api/test/zalopay-gateway.test.ts`: request đúng trường và MAC tính độc lập theo công thức trên; `app_trans_id` đúng ngày GMT+7 ở sát nửa đêm (23:59 UTC+7 và 00:00 UTC+7); ánh xạ `return_code` của truy vấn; lỗi mạng hay lỗi cổng thì đặt mua trả 502 và không giữ hàng
- [x] Callback tự ký bằng key2 của test: đúng MAC thành đã trả, email đúng một lần; sai MAC `-1`, không ghi gì; gửi trùng chỉ một giao dịch; callback và `refresh=1` cùng về chỉ ghi một lần; tiền về sau khi hủy vào đối soát
- [x] Hết hạn: cổng báo đã trả thì đơn thành đã trả, không hủy; cổng lỗi thì vẫn hủy
- [x] Chọn cổng: đủ khóa thì ZaloPay; thiếu một khóa thì ném; production thiếu khóa thì dừng; production với `ZALOPAY_ENV=sandbox` thì dừng

Tài liệu:
- [x] `docs/zalopay.md` thay `docs/payos.md`: bảng chọn cổng, lấy khóa sandbox (`sbmc.zalopay.vn`) và thật (`mc.zalopay.vn`), tunnel tới callback, những điều cần kiểm trên sandbox
- [x] Spec M3: mục "Thanh toán", user story 19, 52, 53, mục API, Testing Decisions, Out of Scope, Further Notes nói về ZaloPay; dòng đầu ghi "đổi cổng sang ZaloPay ngày 2026-11-09, ADR 0009"
- [x] Ticket 12: thêm dòng đầu "Đã được thay bằng ticket 17 (ZaloPay)". Ticket 16: đổi thành thử ZaloPay (sandbox trước, thật sau), đổi tên file `16-thu-zalopay-that.md`
- [x] `GLOSSARY.md`, `project-overview.md`, `.scratch/m0-m1-nen-mong-danh-muc/spec.md` (dòng nói "thanh toán PayOS"): sửa chữ hoặc thêm ghi chú trỏ ADR 0009
- [x] Sau khi xong, `grep -ri payos` chỉ còn ở ADR 0008, ADR 0009, ticket 12, ticket 17 và các ghi chú lịch sử

**Quyết định khi triển khai (2026-11-09):**
- Người dùng chốt 2026-11-09: M3 chỉ thanh toán qua ZaloPay **sandbox**, chưa có tiền thật. `ZALOPAY_ENV` mặc định `sandbox`; host thật cần đặt rõ `ZALOPAY_ENV=production`. Vẫn chặn `NODE_ENV=production` + sandbox trừ khi `PAYMENT_SIMULATOR=allow`, nên `docker compose up` trên máy chạy được với khóa sandbox nhờ `PAYMENT_SIMULATOR=allow` của `.env.example`. Ticket 16 đổi thành `16-thu-zalopay-sandbox.md` ("Thử ZaloPay sandbox"); thử tiền thật chuyển sang Further Notes của spec (việc trước khi mở bán). "M3 xong khi": ticket 01–15, 17 resolved, test và E2E xanh, ticket 16 (sandbox) xong.
- `api/src/payments/zalopay.ts`: `ZaloPayPaymentGateway({ appId, key1, key2, env, callbackUrl?, fetch?, baseUrl?, now? })`, `ZALOPAY_HOSTS`, `zalopayMac(text, key)`, `isValidZaloPayCallback(data, mac, key2)`, `appTransId(orderCode, now)` = `yymmdd` GMT+7 + `_` + mã đơn, `orderCodeFromAppTransId`. Tạo đơn gửi `item: '[]'`, `embed_data: {"redirecturl": returnUrl}`, `bank_code: ''`, `app_user` = mã đơn, `expire_duration_seconds` = thời gian tới hạn giữ hàng (kẹp 300..2592000). Truy vấn: `1` → `paid` kèm một giao dịch (`reference` = `zp_trans_id`), `2` → `failed`, `3` → `pending`, mã khác → `PaymentGatewayError`.
- Interface: `createLink` → `{ checkoutUrl, gatewayReference }`, `getPayment(gatewayReference)`, `cancelLink(gatewayReference)`. `PaymentInfo = { status: 'pending' | 'paid' | 'failed', transactions }` (bỏ `amountPaid` và các trạng thái chỉ PayOS có). `PaymentLinkRequest` bỏ `cancelUrl` (ZaloPay chỉ có `redirecturl`); cổng giả lập không còn gửi `cancelUrl` (trang giả lập không dùng). `InMemoryPaymentGateway.payments`/`cancelled` theo khóa chuỗi.
- `order.gateway_reference` (migration `20261109001700_order_gateway_reference`, unique, null được). Đặt mua lưu mã sau khi tạo link, cùng transaction. `recordGatewayPayments(deps, order)` trong `record-payment.ts` dùng chung cho `refresh=1` và hết hạn; đơn không có mã thì bỏ qua. `cancelPaymentLink(deps, { code, gatewayReference })`.
- Hết hạn: `expireOrder(deps: ExpireDeps, orderId, overdueAt?)` hỏi cổng khi đơn còn `pending_payment` và tới hạn; nút giả lập hết hạn gọi cùng hàm không có `overdueAt`. `ExpireDeps = CancelDeps + { emails, siteUrl }`; `Jobs` nhận thêm `siteUrl`. `createTestApp` trả `expireDeps`.
- Callback `POST /api/payments/zalopay/callback`: shared `ZaloPayCallback`, `ZaloPayCallbackData`, `ZaloPayCallbackResult`. Mã đơn lạ hay `app_trans_id` không đúng dạng trả `1` (không cần gửi lại); đúng MAC mà `data` không đọc được trả `0`. `AppDeps.zalopayCallbackKey` (key2).
- Biến mới `ZALOPAY_CALLBACK_URL` (không có trong ticket): URL tunnel khi thử trên máy; để trống thì `SITE_URL` + `/api/payments/zalopay/callback`.
- Request gửi `application/x-www-form-urlencoded`. Tài liệu (đọc 2026-11-09, `developers.zalopay.vn/v2/general/overview.html`) ghi `/v2/create` và `/v2/query` nhận form, JSON và XML; response truy vấn có `return_code`, `return_message`, `sub_return_code`, `sub_return_message`, `is_processing`, `amount`, `discount_amount`, `zp_trans_id`; không nói `amount` của callback có tính giảm giá/phí không; callback chỉ gửi khi đã thu được tiền.
- Kiểm trên sandbox ở ticket 16: form-urlencoded có được nhận không; response truy vấn có `server_time` không (thiếu thì lấy giờ truy vấn làm `paidAt`); `amount` callback có tính `discount_amount`/`user_fee_amount` không; callback cho đơn đã hết hạn.
- Tài liệu: `docs/zalopay.md` thay `docs/payos.md`. Ticket 03 và 05 giữ chữ PayOS trong phần quyết định như ghi chú lịch sử.
