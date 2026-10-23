# 10: Ảnh sản phẩm và logo thương hiệu

**What to build:**
- Nhân viên có quyền `media.upload` tải nhiều ảnh lên một sản phẩm, sắp xếp thứ tự, nhập alt text, và gắn ảnh vào một hoặc nhiều biến thể, để khi khách đổi màu thì ảnh đổi theo.
- Nhân viên tải được logo cho thương hiệu.
- Ảnh được lưu trên object storage public và phục vụ qua CDN. Khi upload, hệ thống sinh sẵn các cỡ ảnh webp để tải nhanh trên điện thoại.

Ticket này dựng interface storage: R2 khi chạy thật, bản giả lưu trong bộ nhớ khi test. Ticket 13 dùng lại interface này cho bucket private.

**Blocked by:** 09 (Sản phẩm và biến thể nháp, giá có quyền riêng)

**Status:** resolved

- [x] Interface storage có các thao tác: đưa file lên, tạo URL công khai, tạo URL ký có hạn, xóa. Bản R2 dùng API tương thích S3. Test dùng bản giả, inject qua cấu hình app
- [x] Upload đi qua API. API kiểm MIME type thật từ nội dung file (không tin vào đuôi file), chỉ nhận jpeg, png, webp, và giới hạn dung lượng. Sai loại hoặc quá dung lượng thì bị từ chối kèm lỗi rõ ràng
- [x] Khi upload, sinh sẵn các cỡ ảnh webp bằng sharp và giữ cả bản gốc. API trả URL của từng cỡ
- [x] Ảnh gắn với sản phẩm, có thứ tự, có alt text, và tùy chọn gắn vào một hoặc nhiều biến thể của chính sản phẩm đó
- [x] Thương hiệu có logo
- [x] Xóa ảnh thì xóa cả các file trên storage. Mọi thao tác đều ghi audit; thiếu `media.upload` thì 403
- [x] Trình soạn sản phẩm trong admin có vùng tải ảnh, kéo thả để sắp thứ tự, sửa alt text và gắn ảnh vào biến thể. Màn hình thương hiệu có chỗ tải logo
- [x] Có test qua HTTP với storage giả cho các trường hợp:
  - upload hợp lệ tạo đủ các cỡ ảnh;
  - file giả mạo đuôi bị từ chối;
  - quá dung lượng bị từ chối;
  - gắn ảnh vào biến thể của sản phẩm khác bị từ chối;
  - kiểm tra quyền

**Quyết định khi triển khai (2026-10-23):**
- Storage (`api/src/adapters/storage.ts`): interface giữ nguyên (`put`, `publicUrl`, `signedUrl`, `delete`), ghi rõ `publicUrl` chỉ cho bucket `public`, `signedUrl` chỉ cho bucket `private`. Thêm `R2Storage` (`@aws-sdk/client-s3` + `s3-request-presigner`, region `auto`), file public đặt `Cache-Control: immutable` vì key không bao giờ bị ghi đè. Chọn qua `storageFromEnv`: `STORAGE_PROVIDER=r2` cần `R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BUCKET, R2_PRIVATE_BUCKET, MEDIA_PUBLIC_URL` (gốc CDN); `memory` cho local (docker-compose mặc định, ảnh không xem được trên trình duyệt). Ticket 13 dùng `storage.put({ bucket: 'private', … })` và `signedUrl`.
- Module ảnh `api/src/media/images.ts`: `receiveImage` (multer, một file ở trường multipart `file`, tối đa `MAX_IMAGE_BYTES` = 10 MB, quá thì 413 trên `file`), `uploadedFile`, `storeImage(storage, key, file, widths)` kiểm loại thật bằng `sharp().metadata()` (jpeg/png/webp; sai thì 400 trên `file`), giữ bản gốc `<key>/original.<jpg|png|webp>` và sinh `<key>/w<cỡ>.webp` (xoay theo EXIF, không phóng to), `imageRenditions`, `deleteImageFiles(Quietly)`. Ticket 13 nhận thêm pdf nên cần bộ kiểm riêng; có thể dùng lại khung multer. Cỡ ảnh sản phẩm 320/640/1024/1600, logo 160/320. Thư viện mới: `sharp`, `multer`, `@aws-sdk/*`.
- Lưu trữ: migration `20261025001000_product_images_brand_logo`, bảng `product_image` (`storage_key` là tiền tố `products/<productId>/<imageId>`, `content_type`, `width`, `height` sau khi xoay, `widths` các cỡ đã sinh, `alt`, `sort_order`) và `product_image_variant` (khóa `(image_id, variant_id)`). `brand.logo` JSONB `StoredImage` hoặc null; mỗi lần đổi logo dùng tiền tố mới `brands/<brandId>/<uuid>` để CDN không giữ logo cũ.
- API (schema shared trong `shared/src/media.ts`): `GET /api/admin/products/:id/images` (`AdminProductImageList`, theo thứ tự), `POST …/images` (multipart `file`, `alt` tùy chọn; ảnh mới xếp cuối; 201 `AdminProductImage`), `PUT …/images/order` (`{ imageIds }` phải đúng mọi ảnh của sản phẩm, mỗi ảnh một lần, sai thì 400 trên `imageIds`), `PUT …/images/:imageId` (`{ alt, variantIds }`; biến thể không thuộc sản phẩm thì 400 trên `variantIds.N`), `DELETE …/images/:imageId` (204, xóa file sau khi commit). `PUT /api/admin/brands/:id/logo` (multipart `file`) và `DELETE /api/admin/brands/:id/logo` trả `AdminBrand`, nay có `logo: ImageRenditions | null`. `ImageRenditions` = `{ originalUrl, width, height, sizes: [{ width, url }] }`; ticket 11 dựng `srcset` từ đây. `GET /api/admin/products/:id` không đổi (ảnh lấy qua route riêng).
- Quyền: dùng quyền có sẵn `media.upload` cho mọi thao tác ghi ảnh và logo (route ảnh mount trước router sản phẩm, route logo khai báo trước `catalog.edit` của router thương hiệu). Xem ảnh cần `catalog.edit`, `price.edit` hoặc `media.upload`.
- Audit: `media.product_image.upload|update|delete` (`entityType: 'product_image'`, gồm `productId, storageKey, contentType, width, height, alt, sortOrder, variantIds`), `media.product_image.reorder` (`entityType: 'product'`, `{ imageIds }` trước/sau), `media.brand_logo.upload|delete` (`entityType: 'brand'`, `{ logo }` trước/sau). Lưu không đổi gì thì không ghi. Ghi ảnh khóa dòng sản phẩm `FOR UPDATE` (cùng khóa với biến thể), đổi logo khóa dòng thương hiệu.
- File trên storage: upload đẩy file trước rồi mới ghi DB, DB lỗi thì xóa file vừa đẩy; xóa ảnh/đổi logo thì xóa file sau khi commit. Lỗi storage lúc xóa chỉ ghi log (file mồ côi, không ai tham chiếu).
- Web: component `ProductImages` trong `/admin/products/:id` (vùng kéo thả/chọn nhiều file, tải lần lượt, kéo thả để sắp thứ tự, sửa alt text, tick biến thể, xóa); `/admin/brands` có cột logo (tải, đổi, gỡ). Chưa có trang khách nào đổi nên `scripts/smoke.ts` không đổi; API công khai của thương hiệu chưa trả logo (để ticket 11/12 khi dựng trang thương hiệu có sản phẩm).
- Còn mở: bản gốc được giữ nguyên byte trên bucket public, nên còn metadata EXIF (có thể có vị trí GPS) của ảnh chụp. **Cần chủ doanh nghiệp xác nhận** có cần bỏ EXIF khỏi bản gốc (phải mã hóa lại) hay chuyển bản gốc sang bucket private. Quy tắc "không gỡ ảnh cuối cùng của sản phẩm `published`" thuộc ticket 11, chưa làm ở đây. Chưa test `R2Storage` với R2 thật (không có tài khoản trong môi trường này).
