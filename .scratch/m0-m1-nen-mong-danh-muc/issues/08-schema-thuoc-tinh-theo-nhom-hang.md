# 08: Schema thuộc tính theo nhóm hàng

**What to build:**
- Mỗi nhóm hàng có một schema thuộc tính riêng, được seed sẵn theo bảng ở mục 3.1 của `project-overview.md`. Ví dụ: giày dép có hệ size, size, màu, chất liệu; nước hoa có dung tích, nồng độ, nhóm hương.
- Owner hoặc nhân viên có quyền xem và sửa schema trong trang quản trị.
- Hệ thống có một bộ kiểm dữ liệu theo schema, trả lỗi theo từng trường. Ticket 09 dùng bộ kiểm này cho sản phẩm và biến thể.

**Blocked by:** 07 (Thương hiệu và cây danh mục)

**Status:** resolved

- [x] Mỗi định nghĩa thuộc tính gồm:
  - key ổn định, nhãn tiếng Việt;
  - kiểu `enum | multi_enum | text | number | boolean`;
  - bắt buộc hay không, danh sách giá trị cho phép (với kiểu enum), đơn vị (với kiểu number);
  - cấp áp dụng `product | variant`;
  - có dùng làm bộ lọc không, thứ tự hiển thị
- [x] Seed sẵn schema cho cả 5 nhóm hàng; chạy seed lại không tạo trùng
- [x] Schema của cả 5 nhóm hàng đều có thuộc tính cấp sản phẩm `gioi_tinh`, kiểu `enum` với giá trị Nam / Nữ / Unisex, có `filterable` (ADR 0004)
- [x] Mã mẫu là trường chung của sản phẩm (ticket 09), không nằm trong schema thuộc tính của nhóm đồng hồ hay nhóm nào khác
- [x] Bộ kiểm dữ liệu từ chối các trường hợp: thiếu trường bắt buộc, sai kiểu, giá trị enum không nằm trong danh sách, key không có trong schema. Lỗi trả theo cấu trúc lỗi từng trường
- [x] Sửa schema yêu cầu `catalog.edit` và ghi audit kèm schema trước và sau khi sửa
- [x] Quy tắc đổi schema đã cài sẵn: thêm thuộc tính bắt buộc, xóa thuộc tính hoặc bớt giá trị enum đều phải đi qua bước kiểm tra sản phẩm vi phạm. Ở ticket này chưa có sản phẩm nên bước kiểm luôn qua; ticket 09 bổ sung test cho trường hợp có sản phẩm vi phạm
- [x] API công khai trả về schema của một nhóm hàng, để website hiển thị nhãn và bộ lọc
- [x] Trang quản trị có màn hình xem và sửa schema của từng nhóm hàng
- [x] Có test qua HTTP cho các trường hợp:
  - từng loại lỗi kiểm dữ liệu, thông qua một endpoint kiểm thử hoặc endpoint sửa schema;
  - sửa schema ghi audit;
  - kiểm tra quyền

**Quyết định khi triển khai (2026-10-23):**
- Lưu trữ: bảng `attribute_schema`, mỗi nhóm hàng một dòng (khóa chính `product_type`), cột `attributes` JSONB là mảng định nghĩa xếp theo thứ tự hiển thị. Thứ tự hiển thị chính là thứ tự trong mảng, không có trường `sortOrder` riêng. Sửa schema là thay cả mảng.
- Hình dạng định nghĩa (`AttributeDefinition` trong `shared/src/attributes.ts`, union theo `type`): `{ key, label, type, required, level: 'product' | 'variant', filterable }`, thêm `options: string[]` với `enum`/`multi_enum`, `unit: string | null` với `number`. Key dạng `^[a-z][a-z0-9_]*$`, không trùng trong một schema. Giá trị enum là chính chuỗi hiển thị (ví dụ `Nữ`, `Eau de Parfum`), không có cặp mã/nhãn riêng.
- Seed nằm trong migration `20261025000800_attribute_schemas` (`INSERT … ON CONFLICT DO NOTHING`), nên mọi DB, kể cả DB test, đều có đủ 5 schema; chạy lại không tạo trùng và không ghi đè schema owner đã sửa. Thuộc tính seed: giày dép `gioi_tinh, he_size, size, mau, chat_lieu`; quần áo `gioi_tinh, size, mau, chat_lieu, phom_dang`; đồng hồ `gioi_tinh, kich_thuoc_mat (mm), chat_lieu, loai_bo_may`; túi xách `gioi_tinh, kich_thuoc, mau, chat_lieu, kieu_dang, phu_kien_di_kem`; nước hoa `gioi_tinh, dung_tich (ml, cấp biến thể), nong_do, nhom_huong (multi_enum), dang_dong_goi (cấp biến thể)`. Size và màu là `text` cấp biến thể. Mã mẫu, bảng size/hướng dẫn chọn size, hướng dẫn bảo quản là trường chung của sản phẩm (ticket 09); bảo hành không có trong schema (ADR 0005). **Cần chủ doanh nghiệp xác nhận** danh sách giá trị enum đã seed (hệ size, phom dáng, loại bộ máy, kiểu dáng túi, nồng độ, nhóm hương, dạng đóng gói) và việc để size, màu ở dạng chữ tự do.
- Bất biến `gioi_tinh` (ADR 0004): mọi schema phải có `gioi_tinh` cấp sản phẩm, kiểu `enum` đúng ba giá trị Nam / Nữ / Unisex, `filterable`. Chỉ đổi được nhãn, `required` và vị trí; vi phạm thì 400 trên trường `attributes`.
- Bộ kiểm: `checkAttributes(definitions, level, input, path = 'attributes')` trong `@ecommerce/shared` (web dùng được cho form), trả `{ ok: true, values }` hoặc `{ ok: false, fields }`; phía API dùng `assertAttributes(...)` trong `api/src/catalog/attribute-schemas.ts`, ném 400 `VALIDATION_ERROR` với `fields` dạng `<path>.<key>`. Chỉ kiểm thuộc tính của cấp được truyền vào: key thuộc cấp kia cũng tính là "không có trong schema". `null`, chuỗi rỗng và mảng rỗng coi như bỏ trống; giá trị trả về đã bỏ trường trống và cắt khoảng trắng của text. `multi_enum` không nhận giá trị trùng.
- Cho ticket 09: lấy schema bằng `lockAttributeSchema(tx, productType, 'share')` khi ghi sản phẩm/biến thể (sửa schema dùng `'update'`, tức `FOR UPDATE` trên dòng schema), để sản phẩm không lọt qua bước kiểm vi phạm khi schema đang đổi. `findViolatingProducts(tx, productType, definitions)` hiện luôn trả `[]`; ticket 09 cài phần thân bằng cách kiểm mọi sản phẩm và biến thể của nhóm hàng theo schema mới. Mọi lần sửa schema có thay đổi đều đi qua bước này (không phân loại thay đổi nào là "an toàn"), nên thêm thuộc tính bắt buộc, xóa thuộc tính, bớt giá trị enum, đổi kiểu hay đổi cấp đều bị chặn khi có dữ liệu vi phạm. Có vi phạm thì 409 `CONFLICT`, mỗi sản phẩm một mục `fields` với `path: products.<id>`.
- API quản trị (cần `catalog.edit`, quyền có sẵn, dùng cho cả xem lẫn sửa): `GET /api/admin/attribute-schemas` (đủ 5 nhóm theo thứ tự `ProductType`), `GET|PUT /api/admin/attribute-schemas/:productType` (body `{ attributes }`), `POST /api/admin/attribute-schemas/:productType/validate` (body `{ level, attributes }`, trả `{ attributes }` đã chuẩn hóa; là endpoint kiểm thử, cũng dùng được cho form). Sửa ghi audit `catalog.attribute_schema.update`, `entityType: 'attribute_schema'`, `entityId` là nhóm hàng, `before`/`after` là `{ attributes }`; lưu lại đúng schema hiện tại thì không ghi gì.
- API công khai: `GET /api/attribute-schemas/:productType` trả `AttributeSchema` (`{ productType, attributes }`). Chưa có trang khách nào dùng nên `scripts/smoke.ts` không đổi.
- Trang quản trị `/admin/attribute-schemas`: chọn nhóm hàng, sửa bảng thuộc tính (thêm, xóa, lên/xuống), lỗi theo dòng hiện cạnh dòng đó.
- Còn mở: đổi key một thuộc tính được hiểu là xóa rồi thêm mới, chưa có thao tác đổi tên key giữ dữ liệu. Chưa có khóa lạc quan: hai người cùng sửa một schema thì người lưu sau ghi đè.
