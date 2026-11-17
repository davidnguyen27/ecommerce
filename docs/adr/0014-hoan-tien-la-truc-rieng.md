# Hoàn tiền là trục riêng, làm hai bước, thủ công là đường bắt buộc

Hoàn tiền là một bản ghi riêng gắn với đơn. Mỗi lần hoàn có số tiền, lý do, phương thức và trạng thái riêng (chờ hoàn → đang xử lý → đã hoàn hoặc thất bại). Một đơn có thể hoàn nhiều lần, mỗi lần một phần. Hủy đơn chỉ là quyết định kết thúc đơn: đơn đã hủy không có nghĩa là khách đã nhận lại tiền. Trạng thái thanh toán của đơn **không** có giá trị `refunded` hay `partially_refunded`, vì nó chỉ trả lời câu hỏi khách đã trả tới đâu. Số đã hoàn và đang hoàn được tính từ các bản ghi hoàn tiền. Gộp hai trục làm một thì phải đặt ra các tổ hợp như "đã cọc + hoàn một phần", và số lần hoàn có thể nhiều hơn một.

Hoàn tiền làm hai bước:

1. Người có `order.cancel_paid` (owner, sales) hủy đơn và đề xuất số tiền hoàn.
2. Người có `payment.refund` (owner, accountant) thực hiện việc hoàn.

Tổng quan dự án đòi quyền hoàn tiền được cấp rõ ràng. Tách người quyết hủy khỏi người chuyển tiền là kiểm soát tối thiểu.

Đường thủ công là đường phải luôn chạy được: kế toán chuyển khoản ngoài hệ thống, rồi ghi lại mã giao dịch ngân hàng, ngày chuyển và ghi chú. Hệ thống không lưu số tài khoản của khách. Lệnh `refund` của VNPAY là phần thêm. Lệnh này hoàn theo từng giao dịch gốc, nên hoàn qua VNPAY phải gắn một giao dịch gốc và lấy giao dịch mới nhất trước. Khi VNPAY trả "đang xử lý", hệ thống **không** chạy job gọi `querydr`: `querydr` của sandbox không tin được (ADR 0010), và số lần hoàn ít. Kế toán tự kiểm trên cổng merchant rồi chốt kết quả.

## Consequences

- Khi đơn có hoàn tiền chưa xong, danh sách đơn và trang đơn phải tự tính số đã nhận, đã hoàn và đang hoàn. Báo cáo M7 cũng đọc từ bản ghi hoàn tiền, không đọc từ trạng thái thanh toán.
- Khi đã chạy tiền thật và `querydr` dùng được, có thể thêm job theo dõi kết quả hoàn mà không đổi mô hình.
- Lệnh `refund` trên VNPAY sandbox **chưa chạy được** (thử ngày 2026-11-17). Sandbox trả `99 Unexpected error` cho cả hoàn đủ lẫn hoàn một phần, kể cả khi ký bằng khóa sai, giống `querydr` ở ADR 0010. Vì vậy:
  - adapter chỉ được kiểm bằng unit test, chưa chạy với cổng thật;
  - trên sandbox, bấm "Hoàn qua VNPAY" sẽ ra kết quả "thất bại", và kế toán chuyển sang hoàn thủ công.
- Những gì đã biết về lệnh `refund`:
  - chữ ký dùng HMAC-SHA512 như mọi lệnh của phiên bản 2.1.0. Tài liệu của `querydr`/`refund` chỉ ghi `hashWithSecureType`, không nêu tên thuật toán, nên đây là suy luận, chưa xác minh;
  - tài liệu không nêu hạn được hoàn, cũng không giới hạn số lần hoàn một phần trên một giao dịch.
- Trước khi chạy tiền thật cần hỏi VNPAY: endpoint production, thuật toán ký của API giao dịch, hạn hoàn. Sau đó thử một lần hoàn thật với số tiền nhỏ.
