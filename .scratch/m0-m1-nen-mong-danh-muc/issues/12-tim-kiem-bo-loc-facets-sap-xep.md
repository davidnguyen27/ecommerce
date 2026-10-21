# 12: Tìm kiếm, bộ lọc, facets, sắp xếp

**What to build:**
- Khách tìm sản phẩm bằng tiếng Việt không dấu ("giay da" ra "giày da"), theo một phần tên, hoặc theo mã mẫu và SKU. Gõ sai chính tả nhẹ vẫn ra kết quả.
- Khách lọc theo khoảng giá và theo các thuộc tính riêng của nhóm hàng đang xem. Bộ lọc hiện số lượng sản phẩm cho từng giá trị (facets).
- Khách sắp xếp theo mới nhất hoặc theo giá, và phân trang. Mọi thứ dùng tốt trên điện thoại.

**Blocked by:** 11 (Xuất bản, lưu trữ và trang chi tiết sản phẩm)

**Status:** ready-for-agent

- [ ] Tìm từ khóa:
  - chuẩn hóa không dấu bằng `unaccent`, kết hợp full-text với độ tương đồng trigram trên tên sản phẩm, tên thương hiệu và mã mẫu;
  - có index GIN tương ứng;
  - dữ liệu tìm kiếm được cập nhật khi sản phẩm hoặc biến thể thay đổi
- [ ] SKU khớp chính xác hoặc khớp tiền tố được xếp lên đầu kết quả
- [ ] Lọc theo thương hiệu, theo danh mục (gồm cả danh mục con) và theo khoảng giá. Khoảng giá so trên giá của các biến thể đang hoạt động
- [ ] Lọc theo các thuộc tính có `filterable` trong schema của nhóm hàng đang xem; thuộc tính cấp sản phẩm và cấp biến thể đều lọc được
- [ ] Kết quả trả kèm facets: các giá trị chọn được và số lượng của từng giá trị, theo nhóm hàng đang xem, cùng giá thấp nhất và cao nhất
- [ ] Sắp xếp `newest | price_asc | price_desc`; có phân trang. Chỉ trả sản phẩm `published`
- [ ] Website có ô tìm kiếm, trang kết quả, bộ lọc dạng ngăn kéo trên điện thoại, và bộ lọc + sắp xếp phản ánh trên URL để chia sẻ được
- [ ] Có test qua HTTP cho các trường hợp:
  - "giay" tìm ra "Giày";
  - tìm một phần tên và sai chính tả nhẹ vẫn ra kết quả;
  - SKU lên đầu;
  - lọc giá theo giá biến thể;
  - facets đúng với nhóm hàng đang xem;
  - sản phẩm draft hoặc archived không xuất hiện;
  - các kiểu sắp xếp và phân trang đúng
