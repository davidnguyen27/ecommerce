# Kết nối PayOS

Cổng thanh toán thật là PayOS (ADR 0008). Chưa có khóa thì API dùng cổng giả lập `/thanh-toan-gia-lap`. Tài liệu PayOS: https://payos.vn/docs/api/ (đã đọc ngày 2026-11-02).

## Cách API chọn cổng

| Khóa PayOS           | `NODE_ENV`        | Kết quả                                               |
| -------------------- | ----------------- | ----------------------------------------------------- |
| Đủ cả ba             | bất kỳ            | PayOS thật, mở webhook `/api/payments/payos/webhook`  |
| Không có khóa nào    | khác `production` | Cổng giả lập (`pnpm dev`, test)                       |
| Không có khóa nào    | `production`      | API dừng khởi động, trừ khi `PAYMENT_SIMULATOR=allow` |
| Có một hoặc hai khóa | bất kỳ            | API dừng khởi động, báo khóa còn thiếu                |

Image Docker của API luôn chạy `NODE_ENV=production`. Vì vậy `docker compose up` trên máy cần `PAYMENT_SIMULATOR=allow` trong `.env` (đã có trong `.env.example`); `pnpm smoke` tự đặt biến này. Production không bao giờ đặt `PAYMENT_SIMULATOR`: cổng giả lập cho bất kỳ ai báo "đã thanh toán".

## Điền khóa

1. Đăng nhập https://my.payos.vn, mở kênh thanh toán của doanh nghiệp (đã xác thực và liên kết tài khoản nhận tiền).
2. Chép **Client ID**, **Api Key**, **Checksum Key** vào `.env` (không commit):

   ```
   PAYOS_CLIENT_ID=...
   PAYOS_API_KEY=...
   PAYOS_CHECKSUM_KEY=...
   ```

3. `docker compose up --build`. Log `API đang chạy` có `payments: "PayosPaymentGateway"` là đã dùng PayOS.

Nội dung chuyển khoản là `DH<mã đơn>` (8 ký tự). PayOS giới hạn 9 ký tự với tài khoản ngân hàng không liên kết qua payOS, nên mã đơn 7 chữ số trở lên sẽ cần xem lại.

## Tunnel và URL webhook

PayOS phải gọi được webhook qua internet, nên khi chạy trên máy cần tunnel tới Caddy (cổng `HTTP_PORT`, mặc định 80):

```sh
cloudflared tunnel --url http://localhost:80
# hoặc: ngrok http 80
```

URL webhook là `https://<địa-chỉ-tunnel>/api/payments/payos/webhook`. Xác nhận với PayOS bằng API `confirm-webhook` (PayOS gửi thử một webhook có chữ ký tới URL này; API trả 200 cho mã đơn lạ nên bước thử qua được):

```sh
curl -X POST https://api-merchant.payos.vn/confirm-webhook \
  -H "x-client-id: $PAYOS_CLIENT_ID" -H "x-api-key: $PAYOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl":"https://<địa-chỉ-tunnel>/api/payments/payos/webhook"}'
```

Response `code: "00"` là đã lưu. Mỗi lần tunnel đổi địa chỉ phải xác nhận lại. Tắt tunnel thì webhook không tới; khách quay về trang kết quả (`/don-hang/<mã>?ket-qua=1`) vẫn được ghi nhận nhờ truy vấn `refresh=1`.

`SITE_URL` quyết định trang khách quay về sau khi thanh toán. Thử trên cùng máy thì để mặc định; thử bằng điện thoại thì đặt `SITE_URL` là địa chỉ tunnel.

Các bước thử chuyển khoản thật nằm ở ticket 16 (`.scratch/m3-mua-hang/issues/16-thu-payos-that.md`).
