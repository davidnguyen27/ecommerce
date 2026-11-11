# Thanh toán qua ZaloPay, thay cho PayOS

Chủ doanh nghiệp đổi cổng thanh toán từ PayOS sang ZaloPay (thay ADR 0008), vì PayOS không liên kết được tài khoản nhận tiền ở ngân hàng doanh nghiệp đang dùng. Code PayOS chưa từng chạy thật nên được bỏ hẳn, không cần chuyển dữ liệu. ZaloPay vẫn nằm sau interface cổng thanh toán (`api/src/payments/gateway.ts`): test dùng bản trong bộ nhớ và callback tự ký, local dùng cổng giả lập, ghi nhận thanh toán vẫn qua một hàm chạy nhiều lần vẫn cho một kết quả.

## Considered Options

- Giữ PayOS và mở thêm tài khoản nhận tiền ở ngân hàng PayOS hỗ trợ: chủ doanh nghiệp không chọn.
- SePay nhận thẳng vào tài khoản ngân hàng: chỉ báo biến động số dư, phải tự làm trang thanh toán, hết hạn và hủy.

## Consequences

- Mã giao dịch của ZaloPay (`app_trans_id`) phải bắt đầu bằng ngày `yymmdd` theo GMT+7, nên không dùng thẳng mã đơn được. Cổng trả mã này khi tạo link, đơn lưu lại (`order.gateway_reference`) để truy vấn sau. Mã có dạng `yymmdd_<mã đơn>_<8 hex ngẫu nhiên>` (bổ sung 2026-11-10): mã đơn chỉ duy nhất trong một DB, reset DB thì đánh lại, còn merchant sandbox công khai dùng chung cho mọi người, mà ZaloPay từ chối `app_trans_id` trùng (-68).
- ZaloPay không có API hủy đơn chưa thanh toán: hủy đơn ở hệ thống không hủy được trang thanh toán bên ZaloPay. Tiền về cho đơn đã hủy đi vào danh sách cần đối soát như trước.
- Callback luôn trả HTTP 200, kết quả nằm trong `return_code`. Sai MAC trả `-1` và không ghi gì; lỗi phía hệ thống trả `0` để ZaloPay gửi lại.
- ZaloPay yêu cầu merchant tự truy vấn khi không thấy callback, nên trước khi hủy đơn quá hạn, job hết hạn hỏi cổng một lần: đã trả thì ghi nhận, không hủy.
- ZaloPay có sandbox: thử trên sandbox trước, rồi mới thử bằng tiền thật. Production chạy khóa sandbox bị chặn khởi động như khi thiếu khóa.
- Khách có thể trả bằng ví, thẻ hay tài khoản ngân hàng, tùy cấu hình merchant. Tiền lệch tổng đơn ít xảy ra hơn chuyển khoản, nhưng vẫn đi vào danh sách cần đối soát.
- ZaloPay có API hoàn tiền (`/v2/refund`); M6 sẽ quyết định có dùng hay không.
