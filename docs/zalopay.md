# Kết nối ZaloPay

Cổng thanh toán thật là ZaloPay (ADR 0009). Hiện chỉ chạy **sandbox**, chưa nhận tiền thật (người dùng chốt 2026-11-09). Chưa có khóa thì API dùng cổng giả lập `/thanh-toan-gia-lap`. Tài liệu ZaloPay: https://developers.zalopay.vn/v2/general/overview.html và repo mẫu https://github.com/zalopay-samples/quickstart-payment-gateway (đọc ngày 2026-11-09).

## Cách API chọn cổng

| Khóa ZaloPay         | `ZALOPAY_ENV`        | `NODE_ENV`        | Kết quả                                                       |
| -------------------- | -------------------- | ----------------- | ------------------------------------------------------------- |
| Đủ cả ba             | `sandbox` (mặc định) | khác `production` | ZaloPay sandbox, mở callback `/api/payments/zalopay/callback` |
| Đủ cả ba             | `sandbox` (mặc định) | `production`      | API dừng khởi động, trừ khi `PAYMENT_SIMULATOR=allow`         |
| Đủ cả ba             | `production`         | bất kỳ            | ZaloPay thật                                                  |
| Không có khóa nào    | không dùng           | khác `production` | Cổng giả lập (`pnpm dev`, test)                               |
| Không có khóa nào    | không dùng           | `production`      | API dừng khởi động, trừ khi `PAYMENT_SIMULATOR=allow`         |
| Có một hoặc hai khóa | bất kỳ               | bất kỳ            | API dừng khởi động, báo khóa còn thiếu                        |

Image Docker của API luôn chạy `NODE_ENV=production`. Vì vậy `docker compose up` trên máy cần `PAYMENT_SIMULATOR=allow` trong `.env` (đã có trong `.env.example`), dù dùng cổng giả lập hay sandbox; `pnpm smoke` tự xóa khóa ZaloPay và đặt biến này. Bản chạy thật không bao giờ đặt `PAYMENT_SIMULATOR`: cổng giả lập cho bất kỳ ai báo "đã thanh toán", còn sandbox không thu tiền thật.

## Lấy khóa sandbox

1. Đăng nhập https://sbmc.zalopay.vn (trang merchant sandbox), tạo hoặc mở app sandbox.
2. Chép **App ID**, **Key1**, **Key2** vào `.env` (không commit, kể cả khóa sandbox; khóa sandbox công khai trong repo mẫu cũng không commit):

   ```
   ZALOPAY_APP_ID=...
   ZALOPAY_KEY1=...
   ZALOPAY_KEY2=...
   ZALOPAY_ENV=sandbox
   PAYMENT_SIMULATOR=allow
   ```

3. `docker compose up --build`. Log `API đang chạy` có `payments: "ZaloPayPaymentGateway"` là đã dùng ZaloPay.

Key1 ký request gửi ZaloPay (tạo đơn, truy vấn); Key2 kiểm MAC của callback ZaloPay gửi về.

## Tunnel tới callback

ZaloPay phải gọi được callback qua internet, nên khi chạy trên máy cần tunnel tới Caddy (cổng `HTTP_PORT`, mặc định 80):

```sh
cloudflared tunnel --url http://localhost:80
# hoặc: ngrok http 80
```

Đặt `ZALOPAY_CALLBACK_URL=https://<địa-chỉ-tunnel>/api/payments/zalopay/callback` trong `.env` rồi chạy lại API. URL này gửi kèm mỗi đơn, nên không cần cấu hình ở trang merchant; tunnel đổi địa chỉ thì đổi biến. Để trống thì API dùng `SITE_URL` + `/api/payments/zalopay/callback`.

Callback luôn nhận HTTP 200, kết quả nằm trong `return_code`: `1` đã nhận (kể cả đã ghi từ trước), `-1` sai MAC, `0` lỗi phía hệ thống để ZaloPay gửi lại. Tắt tunnel thì callback không tới; khách quay về trang kết quả (`/don-hang/<mã>?ket-qua=1`) vẫn được ghi nhận nhờ truy vấn `refresh=1`, và job hết hạn cũng hỏi ZaloPay trước khi hủy đơn.

`SITE_URL` quyết định trang khách quay về sau khi thanh toán (`redirecturl` trong `embed_data`). Thử trên cùng máy thì để mặc định; thử bằng điện thoại thì đặt `SITE_URL` là địa chỉ tunnel.

## Cần kiểm trên sandbox

Tài liệu chưa nói rõ những điểm dưới đây; code chọn cách có khả năng nhất và để riêng trong `api/src/payments/zalopay.ts`. Ticket 16 (`.scratch/m3-mua-hang/issues/16-thu-zalopay-sandbox.md`) kiểm:

- Request gửi `application/x-www-form-urlencoded`; tài liệu nhận form, JSON và XML, repo mẫu gửi query string với body rỗng.
- Response truy vấn khi đã trả: tài liệu liệt kê `amount`, `discount_amount`, `zp_trans_id`, `is_processing`; code đọc thêm `server_time` nếu có, không có thì lấy giờ truy vấn làm giờ trả.
- `amount` của callback có tính `discount_amount`/`user_fee_amount` không. Khác tổng đơn thì khoản đó vào danh sách cần đối soát.
- Callback có đến cho đơn đã hết hạn không.

## Tiền thật (chưa làm ở M3)

Trước khi mở bán: đăng ký merchant ở https://mc.zalopay.vn, đặt khóa thật với `ZALOPAY_ENV=production`, xóa `PAYMENT_SIMULATOR`, thử một giao dịch số tiền nhỏ qua cả callback và `refresh=1`.
