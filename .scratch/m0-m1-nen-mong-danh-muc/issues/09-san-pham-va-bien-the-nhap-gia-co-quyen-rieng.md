# 09: Sản phẩm và biến thể nháp, giá có quyền riêng

**What to build:**
- Nhân viên có quyền `catalog.edit` tạo và sửa sản phẩm ở trạng thái nháp, gồm:
  - thương hiệu, danh mục, tên, slug, mã mẫu;
  - mô tả, hướng dẫn sử dụng/bảo quản, bảng size;
  - thông tin nguồn gốc công bố, thông tin bảo hành đã xác nhận;
  - thuộc tính cấp sản phẩm, được kiểm theo schema;
  - cờ "chỉ giao đường bộ".
- Nhân viên tạo các biến thể cho sản phẩm. Mỗi biến thể có SKU duy nhất và một tổ hợp thuộc tính cấp biến thể (ví dụ màu × size) không được trùng trong cùng sản phẩm.
- Chỉ người có quyền `price.edit` mới đặt và đổi được giá bán và giá gốc. Mỗi lần đổi giá ghi một bản audit riêng có giá cũ và giá mới.

**Blocked by:** 08 (Schema thuộc tính theo nhóm hàng)

**Status:** ready-for-agent

- [ ] Sản phẩm mới luôn ở trạng thái `draft`. Thuộc tính cấp sản phẩm lưu dạng JSONB, được kiểm theo schema của nhóm hàng (lấy từ danh mục), lỗi trả theo từng trường
- [ ] Bảng size là nội dung có cấu trúc dạng bảng. Thông tin nguồn gốc công bố và thông tin bảo hành là hai trường tách riêng
- [ ] SKU của biến thể là duy nhất toàn hệ thống; tổ hợp thuộc tính của biến thể là duy nhất trong sản phẩm. Trùng thì bị từ chối kèm lỗi rõ ràng
- [ ] `price` và `compare_at_price` là số nguyên VND, đã gồm VAT. `price > 0`; `compare_at_price` để trống hoặc `>= price`
- [ ] Người chỉ có `catalog.edit` mà gửi kèm thay đổi giá thì bị 403. Người có `price.edit` đổi giá thì ghi audit `price.change` gồm biến thể, giá cũ và giá mới
- [ ] Mọi thao tác tạo và sửa sản phẩm, biến thể đều ghi audit
- [ ] Bổ sung cho ticket 08: đổi schema làm sai sản phẩm đang có thì bị từ chối, kèm danh sách sản phẩm bị ảnh hưởng. Danh mục còn sản phẩm thì không xóa được
- [ ] Trang quản trị có danh sách sản phẩm và trình soạn sản phẩm; form thuộc tính được sinh động từ schema; có bảng biến thể. Ô giá chỉ sửa được khi có `price.edit`
- [ ] Có test qua HTTP cho các trường hợp:
  - lỗi thuộc tính theo schema;
  - trùng SKU, trùng tổ hợp;
  - `compare_at_price < price`;
  - có `catalog.edit` nhưng không có `price.edit` thì bị 403 khi đổi giá;
  - audit `price.change` có giá cũ và giá mới;
  - đổi schema có sản phẩm vi phạm thì bị từ chối
