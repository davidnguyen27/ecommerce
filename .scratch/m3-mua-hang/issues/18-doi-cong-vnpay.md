# 18: Đổi cổng thanh toán từ ZaloPay sang VNPAY

**What to build:**
- Bản cài đặt VNPAY của interface cổng thanh toán thay cho ZaloPay (ADR 0010), chạy được ngay khi có khóa sandbox hoặc khóa thật. Bỏ hẳn code ZaloPay.
- IPN của VNPAY ghi nhận thanh toán qua `recordPayment`, như callback ZaloPay trước đây.
- Trang quay về (`refresh=1`) và job hết hạn hỏi VNPAY bằng lệnh `querydr`.
- Tài liệu dự án nói về VNPAY thay cho ZaloPay.

**Blocked by:** 17 (Đổi cổng sang ZaloPay). Thay phần cổng thật của ticket 17.

**Status:** resolved

Lý do (người dùng chốt 2026-11-11): chỉ cần thanh toán thử trên sandbox. Merchant sandbox công khai của ZaloPay chỉ cho trả bằng app ZaloPay sandbox, mà app đó cần tài khoản test ZaloPay cấp tay. VNPAY cho tự đăng ký sandbox và trả bằng thẻ test ngay trên trình duyệt.

Sự kiện về VNPAY (đọc 2026-11-11):
- **Nguồn:**
  - `https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html`
  - `.../truy-van-hoan-tien/querydr&refund.html`
  - `https://sandbox.vnpayment.vn/apis/vnpay-demo/`
- **Đăng ký sandbox:** tự phục vụ ở `https://pay.vnpaytest.vn/dev-registration`. VNPAY gửi `vnp_TmnCode` và `vnp_HashSecret` qua email.
- **URL thanh toán:** GET `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?...`. Tạo ở phía merchant, không gọi API.
  - Tham số `vnp_*`: `Version=2.1.0`, `Command=pay`, `TmnCode`, `Amount` (×100), `CurrCode=VND`, `TxnRef`, `OrderInfo`, `OrderType`, `Locale`, `ReturnUrl`, `IpAddr`, `CreateDate`, `ExpireDate`.
  - Ngày giờ dạng `yyyyMMddHHmmss`, GMT+7.
  - `TxnRef` không được trùng trong ngày.
  - `OrderInfo` là tiếng Việt không dấu, không có ký tự đặc biệt.
  - Không gửi `vnp_SecureHashType`.
- **Chữ ký:** HMAC-SHA512 (hex) trên các tham số `vnp_*` khác rỗng, trừ chữ ký. Sắp tăng dần theo tên, `key=value` đã URL-encode (khoảng trắng thành `+`, theo mẫu PHP/Java), nối bằng `&`.
- **IPN:** GET, cần HTTPS. URL gửi cho VNPAY một lần, không đi theo từng đơn.
  - Tham số: `vnp_Amount`, `vnp_BankCode`, `vnp_PayDate`, `vnp_TransactionNo`, `vnp_ResponseCode`, `vnp_TransactionStatus`, `vnp_TxnRef`, `vnp_SecureHash`…
  - Chỉ thành công khi cả `ResponseCode` lẫn `TransactionStatus` là `00`. Các mẫu của VNPAY không thống nhất (mẫu PHP dùng OR); chọn AND.
  - Trả JSON `{RspCode, Message}`: `00` ok, `01` không thấy đơn, `02` đã xác nhận, `04` sai tiền, `97` sai chữ ký, `99` lỗi khác.
  - `00` và `02` làm VNPAY dừng gửi. Mã khác, hoặc hết thời gian chờ, làm VNPAY gửi lại tối đa 10 lần, cách nhau 5 phút.
- **Return URL:** mang cùng tham số với IPN. Tài liệu dặn chỉ dùng để hiển thị, không cập nhật đơn tại đây.
- **`querydr`:** POST JSON `https://sandbox.vnpayment.vn/merchant_webapi/api/transaction`.
  - Chữ ký là chuỗi nối bằng `|`: `RequestId|Version|Command|TmnCode|TxnRef|TransactionDate|CreateDate|IpAddr|OrderInfo`. `TransactionDate` là `vnp_CreateDate` lúc tạo URL.
  - Response ký trên chuỗi `|` gồm 15 trường.
  - `ResponseCode`: `00` ok, `91` không thấy giao dịch, `97` sai chữ ký, `99` lỗi khác.
  - `TransactionStatus`: `00` thành công, `01` chưa hoàn tất, `02` lỗi.
- **Hủy URL:** không có API. **Hoàn tiền:** có lệnh `refund`, M6 mới dùng.
- **Thẻ test:** NCB `9704198526191432198`, `NGUYEN VAN A`, `07/15`, OTP `123456`.
- **Chưa có trong tài liệu đã đọc:**
  - URL production;
  - thuật toán ký của `querydr` (chỉ ghi `hashWithSecureType`);
  - múi giờ `vnp_PayDate`;
  - cách nối tham số vào return URL đã có query.

- [x] `VnpayPaymentGateway`: URL thanh toán ký sẵn; `getPayment` qua `querydr` (kiểm chữ ký response); `cancelLink` không làm gì
- [x] `GET /api/payments/vnpay/ipn` ánh xạ kết quả `recordPayment` sang `RspCode` (ADR 0010)
- [x] `PaymentLinkRequest` thêm `clientIp`; đặt mua truyền IP khách
- [x] Biến môi trường `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_ENV` (mặc định `sandbox`), `VNPAY_SERVER_IP`; production với sandbox hay thiếu khóa bị chặn trừ khi `PAYMENT_SIMULATOR=allow`
- [x] Bỏ code, test và tài liệu ZaloPay; ADR 0010, `docs/vnpay.md`, spec M3, GLOSSARY, ticket 16 cập nhật theo VNPAY
- [x] Test: URL và chữ ký tính độc lập; `querydr` gửi đúng body, ánh xạ mã; IPN đúng/sai chữ ký, gửi trùng, giao dịch thất bại, mã đơn lạ, tiền về sau khi hủy, IPN và truy vấn cùng về

**Quyết định khi triển khai (2026-11-11):**
- **`vnp_TxnRef = <mã đơn>T<yyyyMMddHHmmss>`** (giờ tạo link, GMT+7), lưu ở `order.gateway_reference`; cột có sẵn nên không cần migration.
  - Giờ tạo trong mã giữ cho mã không trùng khi reset DB. Đây là bài học từ ZaloPay (ticket 16).
  - Truy vấn đọc lại `vnp_TransactionDate` từ chính mã này.
- **Mã trả lời IPN:**
  - `97`: sai chữ ký;
  - `01`: `vnp_TxnRef` lạ, thiếu trường cần dùng, hoặc đơn không có;
  - `00`: giao dịch không thành công (chỉ log), hoặc `recordPayment` trả `paid`/`flagged`;
  - `02`: `duplicate`;
  - `99`: lỗi DB.

  Không dùng `04`: lệch tiền đã vào đối soát.
- **`vnp_OrderInfo`** là mô tả đơn bỏ dấu và ký tự đặc biệt (`asciiOrderInfo`). Cổng giả lập vẫn nhận mô tả có dấu.
- **`vnp_IpAddr`:**
  - Khi tạo link: `req.ip` (đã `trust proxy`), bỏ tiền tố `::ffff:`.
  - Khi truy vấn: `VNPAY_SERVER_IP`, mặc định `127.0.0.1`.
- **Response `querydr`:**
  - Mã `91`, hay trạng thái `01`, là `pending`.
  - `00` kèm `00` là `paid`: `reference` = `vnp_TransactionNo`, `amount` = `vnp_Amount/100`, `paidAt` = `vnp_PayDate` (thiếu thì lấy giờ truy vấn).
  - Trạng thái khác là `failed`.
  - Response sai chữ ký hay mã lỗi khác thì ném `PaymentGatewayError`.
- **`VNPAY_HOSTS.production`** lấy theo hiểu biết chung (`pay.vnpay.vn`, `merchant.vnpay.vn`), có comment "kiểm khi ký hợp đồng".
