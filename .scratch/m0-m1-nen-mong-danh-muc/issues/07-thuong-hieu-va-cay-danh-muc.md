# 07: Thương hiệu và cây danh mục

**What to build:**
- Nhân viên có quyền `catalog.edit` quản lý thương hiệu: tên, slug, mô tả, trạng thái hiển thị. Logo thương hiệu được thêm ở ticket 10.
- Nhân viên quản lý cây danh mục cha–con. Mỗi danh mục thuộc một nhóm hàng (giày dép, quần áo, đồng hồ, túi xách, nước hoa).
- Khách duyệt được trang thương hiệu và trang danh mục trên website. Chưa có sản phẩm thì trang hiển thị trạng thái trống.

**Blocked by:** 03 (Phân quyền, quản lý nhân viên và audit log)

**Status:** ready-for-agent

- [ ] Có sẵn 5 nhóm hàng cố định. Mỗi danh mục gắn với một nhóm hàng; danh mục con phải cùng nhóm hàng với danh mục cha
- [ ] Slug của thương hiệu và danh mục là duy nhất. Không tạo được vòng lặp trong cây danh mục
- [ ] Không xóa được danh mục còn danh mục con (ở các ticket sau là: còn sản phẩm); chỉ ẩn được
- [ ] Mọi thao tác tạo, sửa, ẩn đều ghi audit; thiếu `catalog.edit` thì 403
- [ ] API công khai trả về danh sách thương hiệu đang hiển thị và cây danh mục
- [ ] Trang quản trị có màn hình CRUD thương hiệu và màn hình cây danh mục. Website có menu danh mục, trang thương hiệu và trang danh mục (SSR, ưu tiên điện thoại)
- [ ] Có test qua HTTP cho các trường hợp:
  - slug trùng bị từ chối;
  - danh mục con khác nhóm hàng bị từ chối;
  - tạo vòng lặp trong cây bị từ chối;
  - thương hiệu bị ẩn không xuất hiện ở API công khai;
  - kiểm tra quyền
