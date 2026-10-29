# 03: Khách thấy còn hàng / hết hàng

**What to build:**
- Khách thấy biến thể đang chọn còn hàng hay hết hàng. Biến thể hết hàng vẫn chọn được nhưng hiện mờ kèm chữ "Hết hàng". Mở trang sản phẩm không có `?sku=` thì chọn sẵn biến thể đầu tiên còn hàng.
- Thẻ sản phẩm có nhãn "Hết hàng" khi mọi biến thể đang hiện đều hết. Sản phẩm còn hàng xếp trước sản phẩm hết hàng trong danh mục và tìm kiếm.
- Dữ liệu cấu trúc Product/Offer có `availability`. Khách không bao giờ thấy số tồn.

**Blocked by:** 01 (Tồn theo biến thể, điều chỉnh và sổ xuất nhập)

**Status:** resolved

- [x] Tình trạng còn hàng đọc trực tiếp từ `product_variant.on_hand` cho các biến thể có trong snapshot đang xuất bản, không đưa vào snapshot (ADR 0006). Tồn đổi không tạo phiên bản sản phẩm mới. Cập nhật mục "Snapshot đã xuất bản" của `CODING_STANDARDS.md` để ghi ngoại lệ này
- [x] `PublicProduct.variants[]` và `ProductCard` thêm `inStock: boolean`. Biến thể còn hàng khi `on_hand > 0`; sản phẩm còn hàng khi có ít nhất một biến thể trong snapshot còn hàng. API công khai không trả số tồn
- [x] `api/src/catalog/search.ts`: thứ tự là ưu tiên SKU khớp (giữ nguyên), rồi còn hàng trước hết hàng, rồi cách sắp xếp khách chọn. Facets và tổng số không đổi. Sản phẩm hết hàng vẫn có trong kết quả
- [x] Trang sản phẩm: lựa chọn hết hàng hiện mờ kèm "Hết hàng" nhưng vẫn chọn được; không có `?sku=` hoặc SKU sai thì chọn biến thể đầu tiên còn hàng (hết cả thì biến thể đầu tiên); hiện "Còn hàng" hoặc "Hết hàng" cạnh giá
- [x] Thẻ sản phẩm (`ProductCardGrid`) có nhãn "Hết hàng". Giá "từ X" giữ cách tính hiện tại
- [x] `web/app/utils/seo.ts`: `Offer` có `availability` `InStock`/`OutOfStock`; `AggregateOffer` là `InStock` khi có ít nhất một biến thể còn hàng. Bỏ ghi chú "chưa có availability" hiện có
- [x] `scripts/smoke.ts` kiểm nhãn còn/hết hàng trên trang sản phẩm và `availability` trong JSON-LD
- [x] Có test qua HTTP cho các trường hợp:
  - `inStock` đúng cho biến thể và sản phẩm sau khi điều chỉnh tồn; body công khai không chứa số tồn;
  - sản phẩm hết hàng vẫn có trong tìm kiếm và đứng sau sản phẩm còn hàng, kể cả khi sắp xếp theo giá;
  - SKU khớp vẫn lên đầu dù hết hàng;
  - đổi tồn không đổi số phiên bản đang xuất bản;
  - biến thể không có trong snapshot (ngừng bán, hoặc mới thêm chưa xuất bản) còn hàng thì không làm sản phẩm thành còn hàng

**Quyết định khi triển khai (2026-10-29):**
- `inStockIds(db, variantIds)` trong `api/src/stock/stock.ts` là chỗ duy nhất phía khách đọc tồn; route công khai chỉ gọi hàm này với id biến thể lấy từ snapshot.
- Thứ tự tìm kiếm thêm một biểu thức `EXISTS` nối `snapshot.variants` với `product_variant.on_hand > 0`, đặt sau ưu tiên SKU. Facets và tổng số không đổi. Chưa thêm index riêng; số sản phẩm hiện nhỏ.
- Trang sản phẩm: khi chọn biến thể để dẫn tới cho mỗi lựa chọn, nếu nhiều biến thể khớp ngang nhau thì ưu tiên biến thể còn hàng; lựa chọn hiện "Hết hàng" khi biến thể nó dẫn tới đã hết. Nhãn còn/hết hàng có `data-testid="availability"`.
- Sửa comment cũ trong `PublicProduct.commitments` (đã đọc từ snapshot từ đợt sửa sau review M1, comment vẫn ghi "đọc trực tiếp").
- Smoke: seed nhập tồn cho AM90-DEN-40, để AM90-TRANG-41 hết; 30/30 kiểm tra qua. Test card ở `product-publishing.test.ts` thêm `inStock: false`.
- Cache `swr: 60` giữ nguyên: tình trạng hàng trên website có thể trễ tới khoảng 60 giây (ADR 0006).
- Sau code review (2026-10-29): bỏ gạch ngang trên lựa chọn hết hàng (dễ hiểu nhầm là Ngừng bán), chỉ giữ mờ kèm chữ "Hết hàng"; thêm test biến thể đã ngừng bán (không còn trong phiên bản xuất bản) còn hàng thì sản phẩm vẫn hết hàng.
