# Đổi hàng không tạo đơn mới; chỉ đổi cùng sản phẩm, cùng giá

Đổi hàng (GLOSSARY) là một phần của **yêu cầu hỗ trợ** gắn với đơn gốc, không phải một đơn mới. Khách chỉ đổi được sang một biến thể khác của **cùng sản phẩm** mà giá bán hiện tại **bằng** giá của dòng đơn, nên không có tiền nào đổi chủ. Trình tự:

1. Nhân viên chấp nhận yêu cầu: hệ thống giữ hàng biến thể mới ngay, để không bị bán mất.
2. Kho nhận hàng khách gửi về: nhập lại tồn hoặc ghi hỏng, sổ loại `return`.
3. Kho bàn giao biến thể mới, có mã vận đơn: sổ xuất bán, trỏ về đơn gốc.

Dòng đơn giữ nguyên snapshot lúc đặt mua. Yêu cầu ghi lại "từ biến thể A sang biến thể B, số lượng n", nên hệ thống biết khách đang giữ biến thể nào.

## Considered Options

- **Đơn đổi riêng** (đơn giá 0 hoặc thu chênh lệch). Cách này phải xử lý chênh lệch giá, mã giảm giá đã dùng, phí giao và một lần thanh toán mới, trong khi nhu cầu thật là đổi size hay đổi màu cùng giá.
- **Trả hàng rồi đặt mua lại.** Khách phải nhận tiền hoàn rồi trả tiền lại. Giá có thể đã đổi, hoặc hàng có thể đã hết, giữa hai bước. Đổi sang sản phẩm khác hay giá khác vẫn đi đường này.

## Consequences

- Báo cáo (M7) đọc hàng xuất đi từ sổ xuất nhập: một đơn có thể có nhiều dòng xuất bán (lần giao đầu và các lần giao đổi), không chỉ một.
- Giao biến thể mới chỉ sau khi đã nhận hàng cũ. Như vậy đổi hàng chậm hơn, nhưng không mất hàng khi khách không gửi trả.
- Nếu sau này cần đổi khác giá, phải đổi quyết định này hoặc thêm phương án đơn đổi.
