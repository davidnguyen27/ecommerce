# 06: Tải ảnh hàng loạt theo SKU

**What to build:**
- Nhân viên chọn nhiều file ảnh cùng lúc. Tên file `<SKU>.<đuôi>` hoặc `<SKU>_<n>.<đuôi>`; hệ thống gắn mỗi ảnh vào sản phẩm của SKU đó và gắn với chính biến thể đó, theo thứ tự `n`.
- File không khớp SKU nào, sai định dạng hoặc quá dung lượng thì bị báo lỗi và bỏ qua; các file khác vẫn được tải lên.

**Blocked by:** không có (dựa trên M0+M1)

**Status:** ready-for-agent

- [ ] `POST /api/admin/images/by-sku` (multipart, một file mỗi request, cần `media.upload`): đọc SKU và `n` từ tên file (không có `n` là 0), so khớp SKU không phân biệt hoa thường; không khớp thì lỗi rõ ràng
- [ ] Ảnh nối sau các ảnh hiện có của sản phẩm; các ảnh của cùng SKU xếp theo `n`. Gắn với đúng biến thể của SKU. Dùng lại module media hiện có: kiểm MIME thật và dung lượng, bỏ EXIF, sinh các cỡ webp. Audit như tải ảnh từng cái
- [ ] Trang quản trị: trang **Ảnh hàng loạt** cho chọn nhiều file, gửi lần lượt từng file, hiện tiến độ, cuối cùng hiện danh sách file lỗi kèm lý do. Không có cơ chế ghi tất cả hoặc không ghi gì
- [ ] Có test qua HTTP cho các trường hợp:
  - tên file đúng thì ảnh gắn vào đúng sản phẩm và đúng biến thể, đúng thứ tự theo `n`, nối sau ảnh có sẵn;
  - SKU viết thường vẫn khớp;
  - SKU không tồn tại thì lỗi, không có ảnh nào được lưu;
  - sai MIME hoặc quá dung lượng bị từ chối;
  - thiếu `media.upload` thì 403
