# 17: Đổi cổng thanh toán từ PayOS sang ZaloPay

**What to build:**
- Bản cài đặt ZaloPay của interface cổng thanh toán thay cho PayOS (ADR 0009), chạy được ngay khi có khóa sandbox hoặc khóa thật. Bỏ hẳn code PayOS.
- Callback của ZaloPay ghi nhận thanh toán qua `recordPayment`, như webhook PayOS trước đây.
- Job hết hạn hỏi cổng trước khi hủy đơn quá hạn.
- Tài liệu dự án nói về ZaloPay thay cho PayOS.

**Blocked by:** 12 (Cổng PayOS thật). Thay phần cổng thật của ticket 12.

**Status:** ready-for-agent

Sự kiện về ZaloPay (đọc 2026-11-09, `https://developers.zalopay.vn/v2/general/overview.html` và repo mẫu chính thức `https://github.com/zalopay-samples/quickstart-payment-gateway`):
- Host: sandbox `https://sb-openapi.zalopay.vn`, thật `https://openapi.zalopay.vn`.
- Tạo đơn `POST /v2/create`, các trường `app_id, app_trans_id, app_user, app_time` (ms), `amount, item` (chuỗi JSON), `embed_data` (chuỗi JSON, có `redirecturl`), `description, bank_code, callback_url, expire_duration_seconds, mac`; trả `order_url`. `mac` = HMAC-SHA256 (hex) bằng key1 trên `app_id|app_trans_id|app_user|amount|app_time|embed_data|item`.
- `app_trans_id`: tối đa 40 ký tự, bắt đầu bằng `yymmdd` của ngày hiện tại theo GMT+7, trùng thì lỗi `sub_return_code` -68. `expire_duration_seconds`: 300 đến 2592000.
- Callback: body `{ data, mac, type }`, `data` là chuỗi JSON; `mac` = HMAC-SHA256 bằng key2 trên chuỗi `data`. `data` có `app_id, app_trans_id, app_time, app_user, amount, embed_data, item, zp_trans_id, server_time, channel, merchant_user_id, user_fee_amount, discount_amount`. Trả `{ return_code, return_message }`: `1` thành công, `-1` sai MAC, `0` để ZaloPay gửi lại.
- Truy vấn `POST /v2/query`, `mac` bằng key1 trên `app_id|app_trans_id|key1`; `return_code` `1` đã trả, `2` thất bại, `3` chưa trả hoặc đang xử lý. Merchant phải tự truy vấn nếu không có callback.
- Không có API hủy đơn. Có `/v2/refund` (chưa dùng ở M3).
- Chưa xác minh, để ticket 16 kiểm trên sandbox: request gửi dạng form hay query string (mẫu dùng query string với body rỗng); tên trường đầy đủ của response truy vấn (`zp_trans_id`, `amount`, `server_time`?); `amount` của callback có bao gồm `discount_amount`/`user_fee_amount` không; callback có đến cho đơn đã hết hạn không.

Code:
- [ ] `api/src/payments/zalopay.ts`: `ZaloPayPaymentGateway` theo khuôn `PayosPaymentGateway` cũ (inject `fetch`, `baseUrl`; timeout 15 giây; mọi lỗi thành `PaymentGatewayError`; không tự thử lại). Hàm thuần `zalopayMac`, `isValidZaloPayCallback` (so sánh thời gian hằng), `appTransId(orderCode, now)` theo ngày GMT+7, `orderCodeFromAppTransId`. `app_user` là mã đơn, không gửi email hay số điện thoại khách. `bank_code` rỗng để khách tự chọn cách trả. `cancelLink` không làm gì, comment nêu lý do (ADR 0009)
- [ ] Xóa `api/src/payments/payos.ts`, `api/test/payos-gateway.test.ts`, `api/test/support/payos.ts`, `docs/payos.md`
- [ ] Interface trong `api/src/payments/gateway.ts`: `createLink` trả `{ checkoutUrl, gatewayReference }`; `getPayment(gatewayReference)`; `cancelLink(gatewayReference)`. Bản trong bộ nhớ và cổng giả lập dùng `String(orderCode)` làm mã. Bỏ các comment và trạng thái chỉ PayOS mới có
- [ ] Migration `20261109001700_order_gateway_reference`: cột `order.gateway_reference` TEXT unique, cho phép null; `schema.prisma` đồng bộ. Đặt mua lưu mã này; `refresh=1`, hủy đơn và job hết hạn đọc mã này (đơn không có mã thì bỏ qua bước gọi cổng)
- [ ] `api/src/payments/gateway-from-env.ts`: `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2`, `ZALOPAY_ENV` (`production` mặc định hoặc `sandbox`); đặt thiếu khóa thì ném; production thiếu khóa thì dừng như cũ; `NODE_ENV=production` với `ZALOPAY_ENV=sandbox` cũng dừng, trừ khi có `PAYMENT_SIMULATOR=allow`
- [ ] `POST /api/payments/zalopay/callback` thay `/payos/webhook`: chỉ mở khi đang dùng ZaloPay; kiểm MAC trên chuỗi `data` gốc trước khi parse; parse bằng schema shared; gọi `recordPayment` với `reference` = `zp_trans_id`, `amount`, `paidAt` = `server_time`, nguồn `webhook`. Luôn HTTP 200 với body có kiểu shared: sai MAC `-1`, ghi nhận xong hay đã ghi trước `1`, lỗi bất ngờ `0`
- [ ] Hủy đơn vì hết hạn (job hẹn giờ, job quét, nút giả lập hết hạn): hỏi cổng trước; đã trả thì ghi nhận qua `recordPayment` (nguồn `query`) và không hủy; cổng lỗi thì log rồi vẫn hủy. Khách hoặc nhân viên hủy thì không hỏi cổng
- [ ] Đặt mua: `description` là "Thanh toán đơn hàng #<mã>"; `expire_duration_seconds` khớp hạn giữ hàng
- [ ] `AppDeps.payosChecksumKey` đổi thành khóa callback ZaloPay; `server.ts`, `test-app.ts` theo đó
- [ ] `.env.example`, `docker-compose.yml`, `scripts/smoke.ts`: biến `ZALOPAY_*` thay `PAYOS_*`; smoke vẫn xóa khóa để luôn dùng cổng giả lập
- [ ] Web: `dat-mua.vue` đổi câu "Thanh toán bằng chuyển khoản qua mã VietQR" thành thanh toán qua ZaloPay; `thanh-toan-gia-lap.vue` đổi chữ "khóa PayOS"

Test (HTTP thật, cổng giả):
- [ ] `api/test/zalopay-gateway.test.ts`: request đúng trường và MAC tính độc lập theo công thức trên; `app_trans_id` đúng ngày GMT+7 ở sát nửa đêm (23:59 UTC+7 và 00:00 UTC+7); ánh xạ `return_code` của truy vấn; lỗi mạng hay lỗi cổng thì đặt mua trả 502 và không giữ hàng
- [ ] Callback tự ký bằng key2 của test: đúng MAC thành đã trả, email đúng một lần; sai MAC `-1`, không ghi gì; gửi trùng chỉ một giao dịch; callback và `refresh=1` cùng về chỉ ghi một lần; tiền về sau khi hủy vào đối soát
- [ ] Hết hạn: cổng báo đã trả thì đơn thành đã trả, không hủy; cổng lỗi thì vẫn hủy
- [ ] Chọn cổng: đủ khóa thì ZaloPay; thiếu một khóa thì ném; production thiếu khóa thì dừng; production với `ZALOPAY_ENV=sandbox` thì dừng

Tài liệu:
- [ ] `docs/zalopay.md` thay `docs/payos.md`: bảng chọn cổng, lấy khóa sandbox (`sbmc.zalopay.vn`) và thật (`mc.zalopay.vn`), tunnel tới callback, những điều cần kiểm trên sandbox
- [ ] Spec M3: mục "Thanh toán", user story 19, 52, 53, mục API, Testing Decisions, Out of Scope, Further Notes nói về ZaloPay; dòng đầu ghi "đổi cổng sang ZaloPay ngày 2026-11-09, ADR 0009"
- [ ] Ticket 12: thêm dòng đầu "Đã được thay bằng ticket 17 (ZaloPay)". Ticket 16: đổi thành thử ZaloPay (sandbox trước, thật sau), đổi tên file `16-thu-zalopay-that.md`
- [ ] `GLOSSARY.md`, `project-overview.md`, `.scratch/m0-m1-nen-mong-danh-muc/spec.md` (dòng nói "thanh toán PayOS"): sửa chữ hoặc thêm ghi chú trỏ ADR 0009
- [ ] Sau khi xong, `grep -ri payos` chỉ còn ở ADR 0008, ADR 0009, ticket 12, ticket 17 và các ghi chú lịch sử
