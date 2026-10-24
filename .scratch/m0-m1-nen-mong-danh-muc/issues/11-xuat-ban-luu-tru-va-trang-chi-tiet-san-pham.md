# 11: Xuất bản, lưu trữ và trang chi tiết sản phẩm

**What to build:**
- Nhân viên xuất bản sản phẩm khi đã đủ điều kiện, hoặc lưu trữ sản phẩm không còn kinh doanh mà không mất lịch sử.
- Nhân viên gắn các chính sách áp dụng (đổi trả, bảo hành) vào sản phẩm.
- Khách mở trang chi tiết sản phẩm trên điện thoại và thấy:
  - ảnh lớn;
  - bộ chọn biến thể, chỉ cho chọn những tổ hợp có thật; khi chọn thì giá, SKU và ảnh đổi theo; mỗi biến thể có URL riêng theo SKU, chia sẻ được;
  - giá hãng gạch ngang có nhãn "Giá hãng" (nếu có) và giá bán;
  - thông số đặc trưng của nhóm hàng, có nhãn lấy từ schema;
  - bảng size, hướng dẫn sử dụng/bảo quản;
  - thông tin nguồn gốc công bố;
  - liên kết tới các chính sách áp dụng.
- Trang danh mục và trang thương hiệu hiển thị thẻ sản phẩm có giá "từ X ₫".

**Blocked by:** 04 (Trang nội dung có phiên bản và footer pháp lý), 10 (Ảnh sản phẩm và logo thương hiệu)

**Prototype:** nhánh `prototype/vong-doi-san-pham`, file `api/src/catalog/PROTOTYPE-vong-doi-san-pham.html`. Module `Catalog` trong file (hàm `apply`, `customerView`, `invariants`) đã được chạy thử với các quy tắc vòng đời ở ticket 09 và 11; có thể lấy làm điểm xuất phát.

**Status:** resolved

- [x] Chỉ xuất bản được sản phẩm có ít nhất 1 biến thể đang bán và ít nhất 1 ảnh. Không đủ thì bị từ chối kèm lý do
- [x] Lưu trữ thì sản phẩm biến mất khỏi API công khai nhưng vẫn còn trong admin cùng toàn bộ audit. Có thể đưa về nháp
- [x] Chuyển trạng thái hợp lệ: Nháp → Đã xuất bản; Nháp → Lưu trữ; Đã xuất bản → Lưu trữ; Lưu trữ → Nháp. Không gỡ xuất bản thẳng về Nháp: lưu trữ là cách duy nhất để gỡ sản phẩm khỏi website
- [x] Không gỡ được ảnh cuối cùng của sản phẩm `published` (giống quy tắc biến thể đang bán cuối cùng ở ticket 09); lỗi gợi ý lưu trữ sản phẩm
- [x] Gắn được chính sách vào sản phẩm (tham chiếu trang nội dung loại chính sách ở ticket 04)
- [x] API công khai lấy chi tiết sản phẩm theo slug, trả về: thông tin sản phẩm, schema để hiển thị nhãn, các biến thể đang bán kèm tổ hợp thuộc tính, giá và ảnh, và các chính sách. Sản phẩm draft hoặc archived trả 404
- [x] API danh sách theo danh mục (gồm cả danh mục con) và theo thương hiệu trả về thẻ sản phẩm: giá thấp nhất trong các biến thể đang bán, giá hãng tương ứng, ảnh đại diện
- [x] Trang chi tiết sản phẩm render SSR. Chọn biến thể qua tham số SKU trên URL; mở URL có SKU thì biến thể đó được chọn sẵn
- [x] Xuất bản và lưu trữ đều ghi audit
- [x] Có test qua HTTP cho các trường hợp:
  - xuất bản thiếu biến thể hoặc thiếu ảnh bị từ chối;
  - gỡ ảnh cuối cùng của sản phẩm `published` bị từ chối;
  - đưa sản phẩm `published` thẳng về nháp bị từ chối; lưu trữ từ nháp được chấp nhận;
  - sản phẩm draft hoặc archived không xuất hiện ở API công khai;
  - giá "từ X" đúng là giá thấp nhất của biến thể đang bán;
  - biến thể ngừng bán không được trả về

**Quyết định khi triển khai (2026-10-23):**
- Snapshot đã xuất bản (CODING_STANDARDS): mỗi lần xuất bản tạo một dòng `product_version` (migration `20261025001100_product_publishing`, append-only bằng trigger như `content_page_version`) chứa `snapshot` JSONB `ProductSnapshot` (`api/src/catalog/publication.ts`): mọi trường khách thấy, chỉ biến thể đang bán kèm giá, ảnh (key storage, alt, biến thể gắn), id trang chính sách. Cột chép ra để lọc/sắp xếp: `slug, product_type, brand_id, category_id, from_price, from_compare_at_price, published_at`. `product.live_version_id` trỏ phiên bản khách đang thấy; check constraint `status = published` ⇔ có `live_version_id`. API công khai chỉ đọc từ phiên bản này; tên thương hiệu, danh mục, schema thuộc tính và tiêu đề trang chính sách đọc từ chính chúng (không phải trường của bản soạn sản phẩm). Ticket 12 nên lọc/tìm trên `product_version` của `live_version_id`.
- Hệ quả: sửa sản phẩm, biến thể, **giá**, ảnh, chính sách của sản phẩm đã xuất bản chỉ hiện với khách sau khi "Xuất bản thay đổi" (`PUT …/status` với `published` khi đang xuất bản). Admin có `hasUnpublishedChanges`. **Cần chủ doanh nghiệp xác nhận**: kế toán (`price.edit`) đổi giá thì cần người có `catalog.edit` xuất bản lại mới có hiệu lực; chưa cấp quyền xuất bản cho `price.edit`.
- Vì vậy không cần chặn xóa giá biến thể đang bán của sản phẩm `published` (mục mở của ticket 09): giá khách thấy nằm trong snapshot; xuất bản lại thì bị từ chối tới khi có giá. Điều kiện xuất bản: ít nhất một biến thể đang bán, mọi biến thể đang bán có giá, ít nhất một ảnh; lỗi 409 kèm `fields` (`variants`, `variants.N.price`, `images`).
- API quản trị (quyền `catalog.edit`, quyền có sẵn): `PUT /api/admin/products/:id/status` (`ChangeProductStatusRequest`), `PUT /api/admin/products/:id/policies` (`ProductPoliciesRequest { pageIds }`, chỉ trang loại `policy`, sai thì 400 trên `pageIds.N`), `GET /api/admin/products/policy-pages` (`PolicyPageOptionList`, quyền xem sản phẩm, để người soạn sản phẩm không cần `content.edit`). `GET /api/admin/products/:id` nay trả `AdminProductDetail` (thêm `policyPageIds, liveVersion, hasUnpublishedChanges`). Route trong `api/src/routes/admin-product-publishing.ts`.
- Chuyển trạng thái: published → draft và archived → published bị 409 trên `status`; giữ nguyên trạng thái hoặc xuất bản lại không đổi gì thì 200, không ghi audit, không tạo phiên bản. Audit `catalog.product.publish|archive|unarchive` (`entityType: 'product'`, `{ status, liveVersion }`), `catalog.product.policies` (`{ policyPageIds }`). Lưu trữ giữ nguyên sản phẩm, phiên bản cũ và audit.
- Slug chỉ duy nhất trong bản soạn, nên khi xuất bản kiểm thêm không sản phẩm nào khác đang dùng slug đó trên website (khóa `pg_advisory_xact_lock`), trùng thì 409 trên `slug`. Đổi slug rồi xuất bản lại thì URL cũ 404 (chuyển hướng để ticket 14).
- Ảnh: không gỡ được ảnh cuối cùng của sản phẩm `published` (409 trên `imageId`, gợi ý lưu trữ). Gỡ ảnh còn nằm trong phiên bản khách đang thấy thì giữ file trên storage; file được xóa khi xuất bản lại hoặc lưu trữ. Ảnh chỉ gắn với biến thể ngừng bán không vào snapshot.
- Xóa danh mục mà phiên bản đã xuất bản (kể cả phiên bản cũ) còn tham chiếu thì 409.
- API công khai: `GET /api/products?category=&brand=&page=` (`ProductCardList`, 24/trang, mới xuất bản trước; danh mục gồm mọi danh mục con kể cả đang ẩn; slug không có thì rỗng) và `GET /api/products/:slug` (`PublicProduct`: `attributeSchema` để hiển thị nhãn, `variants` đang bán, `images` kèm `skus`, `policies` chỉ trang đã xuất bản, `brand.slug`/`category` là `null` khi đang ẩn). Thẻ: `fromPrice` thấp nhất, `compareAtPrice` của chính biến thể đó, ảnh đầu tiên. `GET /api/brands/:slug` nay trả `logo`.
- Web: `/san-pham/[slug]` SSR, `?sku=` chọn biến thể; mỗi lựa chọn là link tới SKU của một biến thể có thật gần nhất với lựa chọn hiện tại (chọn được cả khi chưa có JavaScript). `ProductCardGrid` trên `/danh-muc/[slug]` và `/thuong-hieu/[slug]` (phân trang `?trang=`, trang thương hiệu có logo). Admin: mục "Xuất bản" và "Chính sách áp dụng" trong `/admin/products/:id`. `scripts/smoke.ts` dựng một sản phẩm đã xuất bản và kiểm các trang trên.
- Gộp ticket 13: `PublicProduct.commitments` (`publicCommitments`), hiển thị bằng `EvidencedCommitments` ngay sau thông tin nguồn gốc công bố; bỏ route tạm `GET /api/products/:slug/commitments`. Cam kết đọc trực tiếp, không qua snapshot (giữ quyết định đang chờ chủ doanh nghiệp xác nhận ở ticket 13). Smoke dựng thêm một cam kết bảo hành.
- Còn mở: thẻ meta/canonical/schema.org để ticket 14; tìm kiếm, bộ lọc để ticket 12.
- Sau code review (2026-10-24): cam kết có bằng chứng giờ nằm trong `ProductSnapshot.commitments`, chép lúc xuất bản; trang khách đọc từ snapshot. Phiên bản cũ chưa có trường này đọc ra rỗng. Đổi giá biến thể đã xuất bản lên website ngay (xem ticket 09). Nhãn thuộc tính trên trang khách vẫn đọc từ schema hiện tại, không theo snapshot: đã biết, giữ nguyên.
