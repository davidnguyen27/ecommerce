# Hàng nhập về được chia cho đơn đặt trước ngay trong phiếu nhập, từng cái, theo thứ tự cọc

Đơn đặt trước không giữ hàng khi khách cọc, vì hàng chưa có trong kho. Lúc đó đơn chỉ chiếm suất của đợt, và suất không phải là giữ hàng. Hàng chỉ được giữ cho đơn đặt trước khi đã về kho. Mọi phiếu nhập, dù không gắn với đợt nào, đều tự chia hàng của từng biến thể cho các đơn đặt trước đã cọc đang chờ biến thể đó. Việc chia diễn ra trong cùng transaction với phiếu nhập, theo thứ tự thời điểm cọc trên toàn hệ thống, và mỗi lần chia một cái, nên một đơn có thể được giữ một phần. Chỉ phần dư mới thành hàng sẵn. Nếu cách làm là cộng tồn trước rồi phân hàng sau, thì ở khoảng giữa hai bước biến thể thành "còn hàng" (ADR 0007), và khách mua ngay có thể lấy mất hàng của người đã cọc. Nếu bắt nhân viên kho gắn phiếu nhập với đợt, thì chỉ cần quên gắn là hàng cũng bị bán mất như vậy.

## Considered Options

- Thao tác "phân hàng cho đợt" tách khỏi phiếu nhập: có khoảng hở bán mất hàng của người đã cọc.
- Phiếu nhập gắn với một đợt: phụ thuộc vào việc nhân viên kho nhớ gắn.
- Chia trọn đơn, bỏ qua đơn không vừa: hàng dư có thể thành hàng sẵn trong khi một đơn cọc sớm hơn vẫn đang chờ.

## Consequences

- Đơn đặt trước có số lượng đã được giữ hàng. Đơn chỉ thành "hàng đã về" và được mời trả phần còn lại khi số này bằng số lượng của dòng đơn. Hàng đã giữ cho đơn đặt trước không có thời hạn.
- Điều chỉnh tồn và tồn đầu kỳ không chia hàng. Hàng có lại qua điều chỉnh thì thành hàng sẵn.
- Màn hình phiếu nhập phải báo trước bao nhiêu hàng sẽ được giữ cho đơn đặt trước.
- Đơn chỉ đang chờ cọc lúc hàng về thì không được chia. Nếu đơn đó trả cọc sau, nó chờ phiếu nhập kế tiếp.
