# 09: Sản phẩm và biến thể nháp, giá có quyền riêng

**What to build:**
- Nhân viên có quyền `catalog.edit` tạo và sửa sản phẩm ở trạng thái nháp, gồm:
  - thương hiệu, danh mục, tên, slug, mã mẫu;
  - mô tả, hướng dẫn sử dụng/bảo quản, bảng size;
  - thông tin nguồn gốc công bố (không có trường bảo hành; bảo hành là cam kết có bằng chứng ở ticket 13);
  - thuộc tính cấp sản phẩm, được kiểm theo schema;
  - cờ "chỉ giao đường bộ".
- Nhân viên tạo các biến thể cho sản phẩm. Mỗi biến thể có SKU duy nhất và một tổ hợp thuộc tính cấp biến thể (ví dụ màu × size) không được trùng trong cùng sản phẩm. Biến thể ở trạng thái đang bán hoặc ngừng bán.
- Chỉ người có quyền `price.edit` mới đặt và đổi được giá bán và giá hãng (`compare_at_price`, giá bán lẻ chính thức của thương hiệu). Mỗi lần đổi giá ghi một bản audit riêng có giá cũ và giá mới.

**Blocked by:** 08 (Schema thuộc tính theo nhóm hàng)

**Status:** resolved

- [x] Sản phẩm mới luôn ở trạng thái `draft`. Thuộc tính cấp sản phẩm lưu dạng JSONB, được kiểm theo schema của nhóm hàng (lấy từ danh mục), lỗi trả theo từng trường
- [x] Bảng size là nội dung có cấu trúc dạng bảng. Sản phẩm có trường thông tin nguồn gốc công bố và không có trường bảo hành nào (ADR 0005)
- [x] Không chuyển được biến thể đang bán cuối cùng của sản phẩm `published` sang ngừng bán; lỗi gợi ý lưu trữ sản phẩm thay thế
- [x] SKU của biến thể là duy nhất toàn hệ thống; tổ hợp thuộc tính của biến thể là duy nhất trong sản phẩm. Trùng thì bị từ chối kèm lỗi rõ ràng
- [x] `price` và `compare_at_price` là số nguyên VND, đã gồm VAT. `price > 0`; `compare_at_price` để trống hoặc `>= price`
- [x] Người chỉ có `catalog.edit` mà gửi kèm thay đổi giá thì bị 403. Người có `price.edit` đổi giá thì ghi audit `price.change` gồm biến thể, giá cũ và giá mới
- [x] Mọi thao tác tạo và sửa sản phẩm, biến thể đều ghi audit
- [x] Bổ sung cho ticket 08: đổi schema làm sai sản phẩm đang có thì bị từ chối, kèm danh sách sản phẩm bị ảnh hưởng. Danh mục còn sản phẩm thì không xóa được
- [x] Trang quản trị có danh sách sản phẩm và trình soạn sản phẩm; form thuộc tính được sinh động từ schema; có bảng biến thể. Ô giá chỉ sửa được khi có `price.edit`
- [x] Có test qua HTTP cho các trường hợp:
  - lỗi thuộc tính theo schema;
  - trùng SKU, trùng tổ hợp;
  - `compare_at_price < price`;
  - có `catalog.edit` nhưng không có `price.edit` thì bị 403 khi đổi giá;
  - audit `price.change` có giá cũ và giá mới;
  - đổi schema có sản phẩm vi phạm thì bị từ chối;
  - ngừng bán biến thể đang bán cuối cùng của sản phẩm `published` bị từ chối (dựng sản phẩm `published` trực tiếp trong DB vì xuất bản thuộc ticket 11)

**Quyết định khi triển khai (2026-10-23):**
- Lưu trữ: migration `20261025000900_products_variants`, bảng `product` (enum `product_status`) và `product_variant` (enum `variant_status`: `active | discontinued`). Bảng size là JSONB `SizeChart` `{ columns: string[], rows: string[][] }` (mỗi hàng đúng số cột, hoặc `null`). Thông tin nguồn gốc công bố là `originStatement`; không có trường bảo hành nào. Mã mẫu `modelCode`, hướng dẫn sử dụng/bảo quản `usageCare`, cờ `groundShippingOnly`. Liên kết chính sách để ticket 11.
- Nhóm hàng của sản phẩm (`productType`) lấy từ danh mục lúc tạo và cố định; đổi danh mục chỉ trong cùng nhóm hàng (khác nhóm hàng 409 trên `categoryId`), vì đổi nhóm hàng làm sai thuộc tính của mọi biến thể. Sản phẩm không phụ thuộc trạng thái ẩn của thương hiệu/danh mục: gắn được cả thương hiệu, danh mục đang ẩn.
- Giá lưu `BIGINT` (đồng hồ có thể vượt 2,1 tỷ VND), API trả số. `price` để trống được (biến thể nháp do người không có `price.edit` tạo); check constraint trong DB: `price > 0`, `compare_at_price` trống hoặc `>= price` (giá hãng mà chưa có giá bán cũng bị từ chối). **Ticket 11 phải kiểm biến thể đang bán có giá khi xuất bản.**
- SKU lưu chữ hoa (`am90-den-40` thành `AM90-DEN-40`), nên trùng SKU không phân biệt hoa thường. Tổ hợp thuộc tính biến thể duy nhất bằng unique index `(product_id, attributes)` trên JSONB (Prisma không khai báo được, chỉ có trong migration) cộng kiểm tra dưới khóa `FOR UPDATE` trên dòng sản phẩm; tính cả biến thể ngừng bán. Sản phẩm không có thuộc tính cấp biến thể (đồng hồ theo schema seed) vì thế chỉ có một biến thể.
- API quản trị: `GET /api/admin/products` (`AdminProductList`), `GET /api/admin/products/:id` (`AdminProduct` kèm `variants` theo `sortOrder`), `POST /api/admin/products`, `PUT /api/admin/products/:id` (body `ProductRequest`, thay cả nội dung; không đổi trạng thái), `POST /api/admin/products/:id/variants`, `PUT /api/admin/products/:id/variants/:variantId` (body `VariantRequest`; `sortOrder` bỏ qua khi tạo thì xếp cuối). Schema shared trong `shared/src/products.ts`. Lỗi: slug/SKU trùng 409 trên `slug`/`sku`, trùng tổ hợp 409 trên `attributes`, ngừng bán biến thể đang bán cuối cùng của sản phẩm `published` 409 trên `status` (lời nhắn gợi ý lưu trữ sản phẩm).
- Quyền: dùng quyền có sẵn. Xem sản phẩm cần `catalog.edit` **hoặc** `price.edit` (kế toán phải thấy biến thể để đặt giá); `requirePermission` giờ nhận nhiều quyền theo nghĩa "có ít nhất một", `can()` ở web cũng vậy. Tạo/sửa sản phẩm, tạo biến thể cần `catalog.edit`. Ở `PUT` biến thể, quyền tính theo thay đổi: đổi SKU, thuộc tính, trạng thái, thứ tự cần `catalog.edit`; `price`/`compareAtPrice` khác giá hiện tại cần `price.edit` (403 nếu thiếu, kể cả khi tạo biến thể kèm giá). Bỏ qua trường giá hoặc gửi lại đúng giá hiện tại thì không cần `price.edit`. Không có route giá riêng: kế toán gửi cả biến thể với các trường khác giữ nguyên.
- Audit: `catalog.product.create|update` (`entityType: 'product'`, `before`/`after` là toàn bộ trường nghiệp vụ), `catalog.variant.create|update` (`entityType: 'product_variant'`, gồm `productId, sku, attributes, status, sortOrder`, không gồm giá), `price.change` (`entityType: 'product_variant'`, `entityId` là biến thể, `before`/`after` là `{ productId, sku, price, compareAtPrice }`; tạo biến thể kèm giá thì giá cũ là `null`). Lưu không đổi gì thì không ghi.
- Bổ sung ticket 08: `findViolatingProducts` trong `api/src/catalog/attribute-schemas.ts` kiểm thuộc tính của mọi sản phẩm (mọi trạng thái) và biến thể của nhóm hàng theo schema mới. Ghi sản phẩm/biến thể giữ `lockAttributeSchema(tx, type, 'share')`. Xóa danh mục còn sản phẩm thì 409; xóa khóa dòng danh mục `FOR UPDATE`, gắn sản phẩm vào danh mục khóa `FOR KEY SHARE`, nên hai việc này không cùng lọt qua bước kiểm.
- Web: `/admin/products` (danh sách, form tạo có thuộc tính cấp sản phẩm sinh theo schema của danh mục đã chọn) và `/admin/products/:id` (thông tin chung, thuộc tính sinh từ schema qua component `AttributeInput`, bảng size sửa theo ô, bảng biến thể). Ô giá chỉ sửa được và chỉ được gửi khi có `price.edit`; người chỉ có `price.edit` thấy phần còn lại ở dạng chỉ đọc. Schema lấy từ API công khai `/api/attribute-schemas/:productType` vì API quản trị cần `catalog.edit`. Chưa có trang khách nào đổi nên `scripts/smoke.ts` không đổi.
- Sửa nhỏ: chú thích `/// Nút trong cây danh mục…` trong `schema.prisma` bị gắn nhầm sang `AttributeSchema` ở ticket 08, đã chuyển về đúng `Category`.
- Còn mở: chưa có khóa lạc quan khi hai người cùng sửa một sản phẩm (người lưu sau ghi đè). Chưa có thao tác xóa biến thể hay sản phẩm (sản phẩm chỉ lưu trữ ở ticket 11). Chưa chặn xóa giá (`price: null`) của biến thể đang bán thuộc sản phẩm `published`; nên quyết cùng ticket 11.
- Sau code review (2026-10-24): đổi giá biến thể đang có trên website của sản phẩm `published` thì giá mới lên website ngay: cùng transaction tạo một `product_version` mới chép phiên bản đang xuất bản, chỉ thay giá của biến thể đó (`publishedBy` là người đổi giá), ghi `price.change` kèm `catalog.product.publish`; nội dung đang soạn không lộ ra. Không xóa được giá (`price: null`) của biến thể đang bán hoặc đang có trên website thuộc sản phẩm `published` (409, `fields: price`). `PUT` biến thể giờ có `requirePermission('catalog.edit', 'price.edit')` ở cổng, kiểm tra theo từng trường giữ nguyên bên trong. `saveVariant` tách thành `createVariant`/`updateVariant`.
