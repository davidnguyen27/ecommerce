# Tình trạng còn hàng đọc trực tiếp từ tồn kho, không nằm trong snapshot đã xuất bản

Khách chỉ đọc nội dung sản phẩm từ phiên bản đã xuất bản (`product_version.snapshot`), nhưng tình trạng còn hàng là ngoại lệ: API công khai đọc `product_variant.on_hand` trực tiếp, chỉ cho các biến thể có trong snapshot đang xuất bản, và chỉ trả về còn hàng hay hết hàng, không trả số lượng. Chúng tôi không đưa tồn vào snapshot vì mỗi lần nhập kho, điều chỉnh hay bán hàng sẽ sinh một phiên bản sản phẩm mới, làm lịch sử phiên bản mất ý nghĩa và bắt mọi thay đổi kho đi qua luồng xuất bản. Tồn là trạng thái vận hành, không phải nội dung doanh nghiệp duyệt rồi công bố.

## Consequences

- Trang sản phẩm và danh mục cache `swr: 60` nên tình trạng hàng khách thấy có thể trễ tối đa khoảng 60 giây; kiểm tra tồn chính xác phải làm lúc đặt mua (M3).
- Sắp xếp "còn hàng trước" trong tìm kiếm phải nối sang `product_variant`, không chỉ dùng `product_search` và `product_version`.
