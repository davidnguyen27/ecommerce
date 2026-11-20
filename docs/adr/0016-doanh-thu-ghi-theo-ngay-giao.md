# Doanh thu ghi theo ngày giao, tách hẳn khỏi tiền thu

Báo cáo có hai trục không bao giờ cộng lẫn vào nhau (GLOSSARY "Doanh thu", "Tiền thu"):

- **Doanh thu** là tiền hàng sau giảm giá của các đơn đã giao tới khách, ghi theo ngày giao (sự kiện `delivered`). Trả hàng làm giảm doanh thu theo ngày khoản hoàn `origin = return` hoàn xong.
- **Tiền thu** là các khoản cổng thanh toán báo về theo `paidAt`, trừ các khoản hoàn đã xong theo `completedAt`.

Lý do: tổng quan dự án đòi báo cáo tách tiền cọc của đơn chưa giao khỏi giá trị các đơn đã hoàn tất, để chủ doanh nghiệp không nhầm tiền đã nhận với kết quả giao hàng. Với đơn đặt trước, tiền vào ở nhiều thời điểm (cọc, rồi phần còn lại) trước khi hàng tới tay khách. Nếu ghi doanh thu lúc nhận tiền thì một đơn sẽ bị chia ra nhiều kỳ, và đơn sau đó bị hủy sẽ làm sai số của kỳ đã qua.

## Considered Options

- **Ghi lúc nhận tiền.** Dễ tính nhất, nhưng gộp cọc của hàng chưa về vào doanh thu. Đây chính là điều tổng quan dự án yêu cầu tránh.
- **Ghi lúc bàn giao vận chuyển.** Số ra sớm hơn ngày giao, nhưng đơn giao thất bại rồi bị hủy thì phải ghi đảo.

## Consequences

- Ví dụ: một đơn đặt trước cọc tháng 1, giao tháng 3 thì toàn bộ tiền hàng của đơn tính vào doanh thu tháng 3. Tiền cọc nhận trong tháng 1 vẫn có trong tiền thu tháng 1. Chưa giao thì đơn nằm trong "cọc đang giữ".
- Doanh thu không gồm phí giao (để cột riêng), không tách VAT, không gồm mất cọc (để dòng riêng).
- Khoản hoàn của trả hàng có thể gồm cả phí gửi, vì kế toán nhập một số tổng. Toàn bộ khoản đó trừ vào cột "Hàng trả lại", không tách ra.
- Giá vốn và lãi gộp chưa có: phiếu nhập không có giá nhập, và cách tính giá vốn cần kế toán chốt.
