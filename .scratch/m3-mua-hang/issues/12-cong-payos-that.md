# 12: Cổng PayOS thật (khung, chưa có khóa)

**What to build:**
- Bản cài đặt PayOS cho interface cổng thanh toán, chạy được ngay khi có khóa. Chưa cần tài khoản PayOS: khóa để trống trong `.env.example`.
- API chọn cổng theo biến môi trường; ở production, thiếu khóa thì API không khởi động.

**Blocked by:** 05 (Ghi nhận thanh toán)

**Status:** resolved

- [x] Biến môi trường `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` có trong config (Zod) và trong `.env.example`. Trong `.env.example` để trống, kèm comment nói lấy khóa ở đâu
- [x] Adapter PayOS có ba thao tác:
  - tạo link: `POST /v2/payment-requests`, `orderCode` là mã đơn, `expiredAt` là Unix timestamp, request có chữ ký;
  - truy vấn: `GET /v2/payment-requests/{id}`, ánh xạ các trạng thái `PENDING`, `PAID`, `UNDERPAID`, `CANCELLED`, `EXPIRED`, `PROCESSING`, `FAILED` và lấy danh sách giao dịch;
  - hủy link.

  Dùng SDK chính thức nếu đáng tin, không thì dùng `fetch`. Ghi lý do chọn vào quyết định.
- [x] Chọn cổng: đủ ba khóa thì dùng PayOS; thiếu khóa thì dùng cổng giả lập; `NODE_ENV=production` mà thiếu khóa thì API dừng khởi động với thông báo rõ
- [x] Có test cho adapter với HTTP giả, không gọi PayOS thật:
  - request đúng định dạng và đúng chữ ký;
  - ánh xạ trạng thái đúng;
  - lỗi mạng hoặc lỗi từ PayOS thành lỗi cổng, để checkout trả 502.
- [x] Có test: ở production, thiếu khóa thì khởi động thất bại
- [x] Tài liệu ngắn trong `docs/` hoặc README về cách điền khóa, chạy tunnel và xác nhận URL webhook (chuẩn bị cho ticket 16)

**Quyết định khi triển khai (2026-11-02):**
- Nguồn đã đọc ngày 2026-11-02: https://payos.vn/docs/api/ (create, get, cancel, `confirm-webhook`), https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature, và mã nguồn SDK chính thức `@payos/node` 2.0.5 (npm; https://github.com/payOSHQ/payos-lib-node): kiểu `PaymentLinkStatus`, `Transaction`, cách ký request và kiểm chữ ký response.
- **Dùng `fetch`, không dùng SDK.** SDK là của PayOS và đáng tin, nhưng mặc định tự thử lại 2 lần với timeout 60 giây (tạo link chạy trong transaction đặt mua 30 giây); ta chỉ cần ba lời gọi; chữ ký đã có (`payosSignature`); không thêm phụ thuộc. Hành vi bám theo SDK: header `x-client-id`/`x-api-key`, envelope `{ code, desc, data, signature }` với `code` `00` là thành công, kiểm chữ ký `data` của response khi PayOS gửi kèm.
- `PayosPaymentGateway` (`api/src/payments/payos.ts`, nhận `{ clientId, apiKey, checksumKey, fetch?, baseUrl? }`):
  - tạo link `POST /v2/payment-requests` với `orderCode`, `amount`, `description`, `returnUrl`, `cancelUrl`, `expiredAt` (giây Unix), `signature` = HMAC-SHA256 trên `amount, cancelUrl, description, orderCode, returnUrl` (chỉ năm trường, theo tài liệu);
  - truy vấn `GET /v2/payment-requests/{mã đơn}`: `PENDING`/`PROCESSING` → `pending`, `PAID` → `paid`, `UNDERPAID` → `underpaid`, `CANCELLED` → `cancelled`, `EXPIRED` → `expired`, `FAILED` → `failed`; trạng thái lạ là lỗi cổng. Giao dịch lấy `reference`, `amount`, `transactionDateTime` (giờ +07:00), giữ bản gốc làm payload;
  - hủy link `POST /v2/payment-requests/{mã đơn}/cancel` với `cancellationReason: 'Đơn đã hủy'`;
  - mọi lỗi (mạng, timeout 15 giây, HTTP lỗi, `code` khác `00`, sai chữ ký response, sai định dạng) thành `PaymentGatewayError` (mới, `gateway.ts`); checkout vẫn đổi thành 502. Không tự thử lại.
- `PaymentInfo.status` thêm `underpaid` và `failed`. `PaymentTransaction` thêm `payload?` (bản gốc của cổng); `refresh=1` lưu payload này vào giao dịch nguồn `query`.
- Chọn cổng ở `api/src/payments/gateway-from-env.ts` (tách khỏi `gateway.ts` để không vòng import), schema Zod `PaymentEnv`:
  - `payosKeysFromEnv(env)`: đủ ba khóa thì trả khóa; không khóa nào (trống hay khoảng trắng coi như chưa đặt) thì `undefined`; **đặt thiếu thì ném** ở mọi môi trường.
  - `paymentGatewayFromEnv(env, siteUrl)`: đủ khóa → PayOS; không khóa → cổng giả lập, trừ `NODE_ENV=production` thì ném "NODE_ENV=production cần PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY …".
  - `server.ts` gọi trước khi kết nối DB; `payosChecksumKey` lấy từ `payosKeysFromEnv`, nên webhook chỉ mở khi đang dùng PayOS. Log `API đang chạy` ghi tên cổng.
- **Image API luôn chạy `NODE_ENV=production`** (`api/Dockerfile`), nên stack compose của smoke/CI sẽ dừng nếu không làm gì. Chọn cờ bật rõ `PAYMENT_SIMULATOR=allow`, chỉ có tác dụng khi không có khóa:
  - `docker-compose.yml` truyền `PAYOS_*` và `PAYMENT_SIMULATOR` với mặc định **rỗng** (không mặc định `allow`, để deploy quên cấu hình thì dừng chứ không chạy cổng giả lập).
  - `scripts/smoke.ts` đặt `PAYMENT_SIMULATOR=allow` và xóa `PAYOS_*` (smoke không bao giờ tạo link thật), nên CI không cần secret.
  - `.env.example` có `PAYMENT_SIMULATOR=allow` kèm comment xóa ở production.
  - Hệ quả: `docker compose up` trên máy với `.env` cũ (chưa có dòng này) hoặc không có `.env` sẽ dừng, thông báo chỉ cách sửa. `pnpm dev` không bị ảnh hưởng.
- Tài liệu `docs/payos.md`: bảng chọn cổng, điền khóa từ my.payos.vn, tunnel (cloudflared/ngrok tới Caddy), xác nhận webhook bằng `POST https://api-merchant.payos.vn/confirm-webhook` (PayOS gửi thử webhook; route trả 200 cho mã đơn lạ).
- Test:
  - `api/test/payos-gateway.test.ts` (19 test): HTTP giả bằng `fetch` inject; định dạng và chữ ký request kiểm độc lập theo công thức tài liệu; ánh xạ 7 trạng thái; lỗi mạng, HTTP, mã lỗi, sai chữ ký. Qua HTTP: đặt mua trả `checkoutUrl` của PayOS; PayOS lỗi thì 502 và không giữ hàng; `refresh=1` ghi nhận giao dịch PayOS.
  - `api/test/payment-gateway-env.test.ts` (6 test), trong đó một test chạy thật `server.ts` bằng tsx với `NODE_ENV=production` và kiểm API dừng kèm thông báo.
  - Helper mới: `payosResponseSignature` (`test/support/payos.ts`), `createTestApp({ gateway })`.
- Còn mở: nội dung chuyển khoản `DH<mã>` dài 8 ký tự; PayOS giới hạn 9 ký tự với tài khoản không liên kết qua payOS, nên mã đơn từ 10.000.000 cần xem lại. Chưa thấy response thật của PayOS (ticket 16), nhất là chữ ký response của `GET` có mảng `transactions` (làm như SDK).
