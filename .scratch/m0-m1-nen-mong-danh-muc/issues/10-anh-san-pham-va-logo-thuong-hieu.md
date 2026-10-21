# 10: Ảnh sản phẩm và logo thương hiệu

**What to build:**
- Nhân viên có quyền `media.upload` tải nhiều ảnh lên một sản phẩm, sắp xếp thứ tự, nhập alt text, và gắn ảnh vào một hoặc nhiều biến thể, để khi khách đổi màu thì ảnh đổi theo.
- Nhân viên tải được logo cho thương hiệu.
- Ảnh được lưu trên object storage public và phục vụ qua CDN. Khi upload, hệ thống sinh sẵn các cỡ ảnh webp để tải nhanh trên điện thoại.

Ticket này dựng interface storage: R2 khi chạy thật, bản giả lưu trong bộ nhớ khi test. Ticket 13 dùng lại interface này cho bucket private.

**Blocked by:** 09 (Sản phẩm và biến thể nháp, giá có quyền riêng)

**Status:** ready-for-agent

- [ ] Interface storage có các thao tác: đưa file lên, tạo URL công khai, tạo URL ký có hạn, xóa. Bản R2 dùng API tương thích S3. Test dùng bản giả, inject qua cấu hình app
- [ ] Upload đi qua API. API kiểm MIME type thật từ nội dung file (không tin vào đuôi file), chỉ nhận jpeg, png, webp, và giới hạn dung lượng. Sai loại hoặc quá dung lượng thì bị từ chối kèm lỗi rõ ràng
- [ ] Khi upload, sinh sẵn các cỡ ảnh webp bằng sharp và giữ cả bản gốc. API trả URL của từng cỡ
- [ ] Ảnh gắn với sản phẩm, có thứ tự, có alt text, và tùy chọn gắn vào một hoặc nhiều biến thể của chính sản phẩm đó
- [ ] Thương hiệu có logo
- [ ] Xóa ảnh thì xóa cả các file trên storage. Mọi thao tác đều ghi audit; thiếu `media.upload` thì 403
- [ ] Trình soạn sản phẩm trong admin có vùng tải ảnh, kéo thả để sắp thứ tự, sửa alt text và gắn ảnh vào biến thể. Màn hình thương hiệu có chỗ tải logo
- [ ] Có test qua HTTP với storage giả cho các trường hợp:
  - upload hợp lệ tạo đủ các cỡ ảnh;
  - file giả mạo đuôi bị từ chối;
  - quá dung lượng bị từ chối;
  - gắn ảnh vào biến thể của sản phẩm khác bị từ chối;
  - kiểm tra quyền
