# Đặt trước nằm ngoài giỏ hàng; mỗi đơn đặt trước một biến thể

Khách đặt trước bằng nút "Đặt trước" trên trang sản phẩm. Nút này dẫn thẳng tới trang đặt trước của đúng một biến thể (1–5 cái) và tạo ra một đơn đặt trước có một dòng đơn, thanh toán cọc một lần. Giỏ hàng chỉ chứa hàng sẵn, như M3. Tài liệu tổng quan (mục 5.3) đề xuất cho giỏ chứa cả hai loại rồi tách thành nhiều đơn. Chúng tôi không làm vậy, vì một lần đặt mua sinh nhiều đơn sẽ kéo theo nhiều việc: thanh toán nhiều lần, hoặc thêm một "phiên thanh toán" đứng trên nhiều đơn trong khi VNPAY gắn một giao dịch với một `vnp_TxnRef`; phải chia phí giao và voucher sao cho không nhân đôi quyền lợi; và phải chốt chính sách gộp giao. Mỗi đơn đặt trước cũng thuộc đúng một đợt, nên có đúng một lời hẹn giao.

## Considered Options

- Giỏ lẫn lộn, tách thành đơn hàng sẵn và đơn đặt trước, thanh toán lần lượt: khách phải qua cổng hai lần, bỏ dở giữa chừng thì còn một đơn treo.
- Giỏ lẫn lộn, tách đơn nhưng gom một lần thanh toán: cần thực thể thanh toán đứng trên đơn, phân bổ tiền về từng đơn, và đối soát khi tiền lệch.

## Consequences

- Muốn đặt trước hai size hay hai sản phẩm thì khách phải đặt hai lần. Nếu cần giỏ lẫn lộn sau này, nâng lên phương án tách đơn và thanh toán lần lượt.
- Khi M5 có voucher, ưu đãi áp cho đơn đặt trước tính một lần trên đơn, không áp riêng cho cọc và phần còn lại.
