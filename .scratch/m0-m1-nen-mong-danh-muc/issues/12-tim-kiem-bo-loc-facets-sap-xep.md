# 12: Tìm kiếm, bộ lọc, facets, sắp xếp

**What to build:**
- Khách tìm sản phẩm bằng tiếng Việt không dấu ("giay da" ra "giày da"), theo một phần tên, hoặc theo mã mẫu và SKU. Gõ sai chính tả nhẹ vẫn ra kết quả.
- Khách lọc theo khoảng giá và theo các thuộc tính riêng của nhóm hàng đang xem. Bộ lọc hiện số lượng sản phẩm cho từng giá trị (facets).
- Khách sắp xếp theo mới nhất hoặc theo giá, và phân trang. Mọi thứ dùng tốt trên điện thoại.

**Blocked by:** 11 (Xuất bản, lưu trữ và trang chi tiết sản phẩm)

**Status:** resolved

- [x] Tìm từ khóa:
  - chuẩn hóa không dấu bằng `unaccent`, kết hợp full-text với độ tương đồng trigram trên tên sản phẩm, tên thương hiệu và mã mẫu;
  - có index GIN tương ứng;
  - dữ liệu tìm kiếm được cập nhật khi sản phẩm hoặc biến thể thay đổi
- [x] SKU khớp chính xác hoặc khớp tiền tố được xếp lên đầu kết quả
- [x] Lọc theo thương hiệu, theo danh mục (gồm cả danh mục con) và theo khoảng giá. Khoảng giá so trên giá của các biến thể đang bán
- [x] Lọc theo các thuộc tính có `filterable` trong schema của nhóm hàng đang xem; thuộc tính cấp sản phẩm và cấp biến thể đều lọc được. Lọc giới tính Nam hoặc Nữ thì kết quả gồm cả sản phẩm Unisex; facets vẫn đếm riêng từng giá trị Nam / Nữ / Unisex
- [x] Menu Nam / Nữ trên website dẫn tới trang kết quả có lọc giới tính tương ứng (ADR 0004)
- [x] Kết quả trả kèm facets: các giá trị chọn được và số lượng của từng giá trị, theo nhóm hàng đang xem, cùng giá thấp nhất và cao nhất
- [x] Sắp xếp `newest | price_asc | price_desc`; có phân trang. Chỉ trả sản phẩm `published`
- [x] Website có ô tìm kiếm, trang kết quả, bộ lọc dạng ngăn kéo trên điện thoại, và bộ lọc + sắp xếp phản ánh trên URL để chia sẻ được
- [x] Có test qua HTTP cho các trường hợp:
  - "giay" tìm ra "Giày";
  - tìm một phần tên và sai chính tả nhẹ vẫn ra kết quả;
  - SKU lên đầu;
  - lọc giá theo giá biến thể;
  - facets đúng với nhóm hàng đang xem;
  - lọc giới tính Nam ra cả sản phẩm Unisex, không ra sản phẩm Nữ;
  - sản phẩm draft hoặc archived không xuất hiện;
  - các kiểu sắp xếp và phân trang đúng

**Quyết định khi triển khai (2026-10-23):**
- Tìm kiếm đọc phiên bản đang xuất bản (CODING_STANDARDS "Snapshot đã xuất bản"): bảng `product_search` (migration `20261025001200_product_search`), mỗi sản phẩm đang hiện một dòng, dựng từ `product_version` của `live_version_id` và tên thương hiệu hiện tại. Cột `document` (tên + thương hiệu + mã mẫu qua `search_normalize` = `lower(unaccent(...))`), `tsv` (cấu hình `simple`; tên, mã mẫu trọng số A, thương hiệu B), `skus` (SKU đang bán, bao bởi dấu cách); GIN trên `tsv`, GIN `gin_trgm_ops` trên `document` và `skus`. Chỉ trigger ghi bảng: khi `product.live_version_id` đổi (xuất bản, xuất bản lại, lưu trữ) và khi đổi tên thương hiệu. Vì vậy "cập nhật khi sản phẩm hoặc biến thể thay đổi" nghĩa là khi thay đổi được xuất bản, như mọi dữ liệu khách thấy (ticket 11). Bộ lọc và facets đọc thẳng `product_version.snapshot` (hàm SQL `attribute_values`).
- Khớp từ khóa: full-text khớp tiền tố từng từ (`search_prefix_query`), hoặc `word_similarity` trigram ≥ 0,6 (toán tử `<%`, ngưỡng mặc định của pg_trgm), hoặc tiền tố SKU. SKU khớp chính xác xếp đầu, rồi SKU khớp tiền tố (từ khóa từ 3 ký tự), rồi theo `sort`; có từ khóa mà không có `sort` thì theo độ liên quan (ts_rank / word_similarity). Không có từ khóa thì mặc định mới xuất bản trước.
- API: `GET /api/products` mở rộng, trả `ProductSearchResult` (`ProductCardList` + `productType` + `facets { productTypes, attributes, price }`). Tham số `ProductListQuery`: `q, category, brand, type, minPrice, maxPrice, sort (newest|price_asc|price_desc), page`; bộ lọc thuộc tính là `attr.<key>=<giá trị>`, lặp lại được (`ATTRIBUTE_FILTER_PREFIX`, `attributeFiltersOf` trong shared). Nhiều giá trị của một thuộc tính là OR, giữa các thuộc tính là AND. Ô trống (`minPrice=`) coi như không lọc; giá trị sai kiểu thì 400 theo trường.
- Nhóm hàng đang xem = nhóm của danh mục, không có thì `type`. Chưa xác định (tìm chung, trang thương hiệu, menu Nam/Nữ) thì chỉ lọc và có facet `gioi_tinh` (chung mọi schema), kèm facet `productTypes` để thu hẹp. Key không `filterable` ở nhóm đang xem thì bỏ qua, không báo lỗi (URL cũ sau khi đổi schema vẫn mở được).
- Giá và thuộc tính cấp biến thể phải khớp trên cùng một biến thể đang bán. Thẻ vẫn hiện giá "từ" thấp nhất; sắp xếp theo giá dùng giá "từ". Facet của mỗi thuộc tính đếm sản phẩm khớp mọi bộ lọc trừ chính nó; `facets.price` là giá biến thể thấp nhất/cao nhất khi bỏ bộ lọc giá. Giá trị enum theo thứ tự schema, còn lại theo chữ (số so theo giá trị).
- Giới tính (ADR 0004): lọc Nam hoặc Nữ thì thêm Unisex vào tập giá trị; facet vẫn đếm riêng Nam / Nữ / Unisex.
- Web: ô tìm kiếm (`role="search"`, form GET) và menu Nam / Nữ (`/tim-kiem?attr.gioi_tinh=Nam|Nữ`) ở đầu mọi trang; trang `/tim-kiem`; component `ProductSearch` dùng chung cho `/tim-kiem`, `/danh-muc/[slug]`, `/thuong-hieu/[slug]`: sắp xếp là link, bộ lọc là form GET trong ngăn kéo `<details>` (dùng được khi chưa có JavaScript; có JavaScript thì đổi URL tại chỗ), mọi lựa chọn nằm trên URL, phân trang `?trang=`. `scripts/smoke.ts` thêm kiểm tìm không dấu, tìm SKU, lọc Nam/Nữ, bộ lọc ở trang danh mục.
- Không thêm quyền (chỉ API công khai).
- **Cần chủ doanh nghiệp xác nhận**: ngưỡng sai chính tả (0,6) và mức tối thiểu 3 ký tự cho khớp tiền tố SKU; khi chưa chọn nhóm hàng thì chỉ lọc được giới tính, giá và nhóm hàng.
