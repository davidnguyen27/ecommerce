# Thanh toán qua PayOS (chuyển khoản VietQR)

Chủ doanh nghiệp chọn PayOS làm cổng thanh toán duy nhất; tài liệu VNPAY trong overview chỉ dùng tham khảo cách xử lý IPN, truy vấn và hoàn tiền. PayOS chỉ nhận chuyển khoản Napas qua VietQR (không có thẻ), không có môi trường sandbox và không có API hoàn tiền, nên: PayOS nằm sau một interface cổng thanh toán để test tự động dùng bản giả lập và webhook tự ký; thử thật bằng chuyển khoản số nhỏ trên tài khoản của doanh nghiệp; hoàn tiền là nhân viên chuyển khoản tay rồi ghi nhận vào hệ thống.

## Consequences

- Xác nhận đã thanh toán đến từ hai đường (webhook có chữ ký và server tự truy vấn khi khách quay về), cùng gọi một hàm ghi nhận chạy nhiều lần vẫn cho một kết quả; PayOS không công bố việc gửi lại hay gửi trùng webhook.
- Tiền về lệch tổng đơn, hoặc về cho đơn đã hết hạn/hủy, không được tự xử lý mà vào danh sách cần đối soát.
- Mã đơn là số nguyên tăng dần vì PayOS yêu cầu `orderCode` kiểu số.
