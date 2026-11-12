# Thanh toán qua VNPAY, thay cho ZaloPay

Người dùng đổi cổng thanh toán từ ZaloPay sang VNPAY ngày 2026-11-11 (thay ADR 0009). Lý do: hiện chỉ cần thanh toán thử trên sandbox. ZaloPay sandbox tạo và truy vấn đơn được, nhưng merchant sandbox công khai chỉ cho trả bằng app ZaloPay sandbox, mà app đó cần tài khoản test do ZaloPay cấp tay qua nhóm hỗ trợ. VNPAY cho tự đăng ký sandbox (thông tin kết nối gửi qua email) và trả bằng thẻ ATM test kèm OTP cố định ngay trên trình duyệt, không cần app.

Code ZaloPay mới chạy sandbox, chưa có giao dịch thật nào, nên được bỏ hẳn. Không cần chuyển dữ liệu: cột `order.gateway_reference` giữ nguyên, chỉ đổi nội dung. VNPAY vẫn nằm sau interface cổng thanh toán (`api/src/payments/gateway.ts`). Test dùng bản trong bộ nhớ và IPN tự ký, local dùng cổng giả lập. Mọi đường ghi nhận thanh toán vẫn đi qua một hàm chạy nhiều lần vẫn cho một kết quả.

## Considered Options

- Giữ ZaloPay và xin ZaloPay cấp tài khoản sandbox: phải chờ ZaloPay, người dùng không chọn.
- Giả lập callback ZaloPay trên máy: kiểm được code của dự án, nhưng không thật sự trả tiền trên sandbox.

## Consequences

- **Link thanh toán là URL ký sẵn** (HMAC-SHA512), không gọi API của VNPAY. Đặt mua không còn lỗi mạng ở bước tạo link.
- **Thông tin khách gửi VNPAY:** VNPAY đòi IP của khách (`vnp_IpAddr`), nên yêu cầu tạo link mang thêm `clientIp`. `vnp_OrderInfo` phải là tiếng Việt không dấu, không có ký tự đặc biệt.
- **Mã giao dịch `vnp_TxnRef`** có dạng `<mã đơn>T<yyyyMMddHHmmss>`, theo giờ Việt Nam lúc tạo link, và lưu ở `order.gateway_reference`.
  - VNPAY không cho trùng mã trong ngày, mà mã đơn đánh lại từ đầu khi reset DB; giờ tạo trong mã giữ cho mã không trùng.
  - Truy vấn cần đúng giờ tạo link (`vnp_TransactionDate`), nên đọc lại từ chính mã này.
- **URL IPN khai với VNPAY một lần**, không gửi theo từng đơn như callback của ZaloPay. VNPAY gọi IPN bằng GET qua HTTPS. Mã trả lời:
  - `97`: sai chữ ký, không ghi gì;
  - `01`: không thấy đơn;
  - `02`: giao dịch đã ghi từ trước;
  - `99`: lỗi phía hệ thống, để VNPAY gửi lại;
  - `00`: các trường hợp còn lại, kể cả giao dịch không thành công và tiền lệch tổng đơn.

  Tiền lệch đã vào danh sách cần đối soát, nên không trả `04`: VNPAY gửi lại cũng không thay đổi gì.

- **Chỉ coi là đã trả** khi `vnp_ResponseCode` và `vnp_TransactionStatus` cùng là `00`. Các mẫu code của VNPAY không thống nhất chỗ này; chọn cách chặt hơn.
- **Không có API hủy URL thanh toán.** URL hết hạn theo `vnp_ExpireDate`, đặt bằng hạn giữ hàng. Tiền về cho đơn đã hủy đi vào danh sách cần đối soát như trước.
- **Truy vấn qua API `querydr`.** Trang quay về (`refresh=1`) và job hết hạn hỏi cổng như với ZaloPay. Thiếu IPN, ví dụ khi chạy trên máy không có tunnel, đơn vẫn được ghi nhận.
- **Sandbox:** có, tự đăng ký được. Production chạy khóa sandbox bị chặn khởi động như khi thiếu khóa.
- **Còn phải kiểm:**
  - Địa chỉ production chưa có trong tài liệu đã đọc, kiểm khi ký hợp đồng.
  - Tài liệu không ghi thuật toán ký của `querydr`, kiểm trên sandbox.
- **Hoàn tiền:** VNPAY có lệnh `refund` trên cùng API; M6 sẽ quyết định có dùng hay không.
