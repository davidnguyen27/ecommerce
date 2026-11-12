# Kết nối VNPAY

Cổng thanh toán thật là VNPAY (ADR 0010). Hiện chỉ chạy **sandbox**, chưa nhận tiền thật (người dùng chốt 2026-11-11). Chưa có khóa thì API dùng cổng giả lập `/thanh-toan-gia-lap`.

Tài liệu VNPAY (đọc ngày 2026-11-11):

- https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html
- https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr&refund.html
- https://sandbox.vnpayment.vn/apis/vnpay-demo/

## Cách API chọn cổng

| Khóa VNPAY        | `VNPAY_ENV`          | `NODE_ENV`        | Kết quả                                               |
| ----------------- | -------------------- | ----------------- | ----------------------------------------------------- |
| Đủ cả hai         | `sandbox` (mặc định) | khác `production` | VNPAY sandbox, mở IPN `/api/payments/vnpay/ipn`       |
| Đủ cả hai         | `sandbox` (mặc định) | `production`      | API dừng khởi động, trừ khi `PAYMENT_SIMULATOR=allow` |
| Đủ cả hai         | `production`         | bất kỳ            | VNPAY thật                                            |
| Không có khóa nào | không dùng           | khác `production` | Cổng giả lập (`pnpm dev`, test)                       |
| Không có khóa nào | không dùng           | `production`      | API dừng khởi động, trừ khi `PAYMENT_SIMULATOR=allow` |
| Chỉ có một khóa   | bất kỳ               | bất kỳ            | API dừng khởi động, báo khóa còn thiếu                |

Image Docker của API luôn chạy `NODE_ENV=production`, nên `docker compose up` trên máy cần `PAYMENT_SIMULATOR=allow` trong `.env` (đã có trong `.env.example`), dù dùng cổng giả lập hay sandbox. `pnpm smoke` tự xóa khóa VNPAY và tự đặt biến này.

Bản chạy thật không bao giờ đặt `PAYMENT_SIMULATOR`: cổng giả lập cho bất kỳ ai báo "đã thanh toán", còn sandbox không thu tiền thật.

## Lấy khóa sandbox

1. Đăng ký ở https://pay.vnpaytest.vn/dev-registration. VNPAY gửi thông tin kết nối qua email: **vnp_TmnCode** (mã định danh kết nối) và **vnp_HashSecret** (chuỗi bí mật).
2. Chép vào `.env` (không commit, kể cả khóa sandbox):

   ```
   VNPAY_TMN_CODE=...
   VNPAY_HASH_SECRET=...
   VNPAY_ENV=sandbox
   PAYMENT_SIMULATOR=allow
   ```

3. Chạy `docker compose up --build`. Log `API đang chạy` có `payments: "VnpayPaymentGateway"` là đã dùng VNPAY.

`vnp_HashSecret` dùng để ký URL thanh toán và lệnh truy vấn, và để kiểm chữ ký của IPN (HMAC-SHA512).

## Trả tiền trên sandbox

Đặt một đơn trên website, rồi ở trang VNPAY chọn **Thẻ nội địa và tài khoản ngân hàng**, ngân hàng **NCB**, và nhập:

| Trường         | Giá trị               |
| -------------- | --------------------- |
| Số thẻ         | `9704198526191432198` |
| Tên chủ thẻ    | `NGUYEN VAN A`        |
| Ngày phát hành | `07/15`               |
| OTP            | `123456`              |

Các thẻ test khác, gồm thẻ báo lỗi (không đủ số dư, thẻ khóa) và thẻ quốc tế, có ở https://sandbox.vnpayment.vn/apis/vnpay-demo/.

Trả xong, VNPAY đưa khách về `/don-hang/<mã>?ket-qua=1&vnp_...`. Trang này hỏi VNPAY (`refresh=1`, lệnh `querydr`) rồi ghi nhận khoản tiền. Các tham số `vnp_*` trên URL chỉ để hiển thị; hệ thống không tin chúng.

## IPN (VNPAY báo kết quả về server)

IPN là đường ghi nhận chính khi chạy thật. Khi thử trên máy thì không bắt buộc, vì trang quay về và job hết hạn đã truy vấn VNPAY. Muốn thử IPN:

1. Mở tunnel HTTPS tới Caddy (cổng `HTTP_PORT`, mặc định 80):

   ```sh
   cloudflared tunnel --url http://localhost:80
   ```

2. Gửi cho VNPAY URL `https://<địa-chỉ-tunnel>/api/payments/vnpay/ipn`. URL IPN không đi theo từng đơn: tài liệu nói gửi cho VNPAY khi thiết lập xong, hoặc khai ở trang quản trị merchant sandbox nếu có mục đó. Tunnel đổi địa chỉ thì phải khai lại.

IPN trả JSON `{ RspCode, Message }`:

- `00`: đã nhận (kể cả giao dịch không thành công và tiền lệch, đã vào danh sách cần đối soát);
- `01`: không thấy đơn;
- `02`: đã ghi từ trước;
- `97`: sai chữ ký;
- `99`: lỗi phía hệ thống, để VNPAY gửi lại.

VNPAY gửi lại khi nhận mã khác `00`/`02`, tối đa 10 lần, cách nhau 5 phút.

## Cần kiểm trên sandbox

Tài liệu chưa nói rõ những điểm dưới đây. Code chọn cách có khả năng đúng nhất và để riêng trong `api/src/payments/vnpay.ts`. Ticket 16 (`.scratch/m3-mua-hang/issues/16-thu-vnpay-sandbox.md`) sẽ kiểm:

- Thuật toán ký lệnh `querydr`: tài liệu chỉ ghi `hashWithSecureType`; code dùng HMAC-SHA512 như URL thanh toán.
- VNPAY nối tham số `vnp_*` vào `vnp_ReturnUrl` đã có sẵn query (`?ket-qua=1`) như thế nào.
- `vnp_PayDate` là giờ Việt Nam (code giả định GMT+7).
- `vnp_ExpireDate` có thật sự chặn thanh toán sau hạn không.

## Tiền thật (chưa làm ở M3)

Trước khi mở bán:

- ký hợp đồng merchant với VNPAY;
- xác nhận địa chỉ production (`VNPAY_HOSTS` trong code đang theo hiểu biết chung, chưa đối chiếu tài liệu), biểu phí, và việc nhận tiền về tài khoản TPBank;
- đặt khóa thật với `VNPAY_ENV=production`, xóa `PAYMENT_SIMULATOR`, khai URL IPN thật;
- thử một giao dịch số tiền nhỏ, ghi nhận qua cả IPN và `refresh=1`.
