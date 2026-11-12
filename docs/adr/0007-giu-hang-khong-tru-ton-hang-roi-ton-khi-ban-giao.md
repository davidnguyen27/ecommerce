# Giữ hàng không trừ tồn; hàng rời tồn khi bàn giao vận chuyển

Khi khách đặt mua, đơn giữ hàng bằng một số đếm riêng (`reserved`) cạnh tồn (`on_hand`), có thời hạn khi chưa thanh toán và hết thời hạn khi đã thanh toán. Tồn chỉ giảm, kèm dòng sổ xuất nhập loại xuất bán, lúc bàn giao vận chuyển. Khách thấy còn hàng khi tồn trừ số đang giữ lớn hơn 0; điều này thay cho điều kiện "tồn > 0" của ADR 0006, phần còn lại của ADR 0006 giữ nguyên. Chúng tôi chọn như vậy vì tồn được định nghĩa là hàng thực có trong kho: trừ tồn ngay lúc thanh toán sẽ làm sổ xuất nhập và kiểm kê lệch với hàng còn nằm trên kệ chờ đóng gói, còn đơn hết hạn chỉ cần nhả số giữ mà không phải ghi hai dòng sổ ngược nhau.

## Considered Options

- Trừ tồn lúc đặt mua và cộng lại khi đơn hết hạn: sổ xuất nhập đầy dòng giữ/nhả không phản ánh hàng di chuyển thật.
- Trừ tồn lúc thanh toán: kiểm kê trong lúc có đơn chờ đóng gói sẽ báo thiếu hàng giả.

## Consequences

- Chốt chặn "không âm" phải áp cho cả hai: `reserved <= on_hand` khi giữ hàng, và `on_hand >= 0` khi bàn giao; kiểm kê hạ tồn xuống dưới số đang giữ phải bị chặn hoặc cảnh báo.
- Mọi chỗ đọc "còn hàng" (trang sản phẩm, tìm kiếm, sắp xếp còn hàng trước) đổi sang `on_hand - reserved > 0`.
