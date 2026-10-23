# 07: Thương hiệu và cây danh mục

**What to build:**
- Nhân viên có quyền `catalog.edit` quản lý thương hiệu: tên, slug, mô tả, trạng thái hiển thị. Logo thương hiệu được thêm ở ticket 10.
- Nhân viên quản lý cây danh mục cha–con. Mỗi danh mục thuộc một nhóm hàng (giày dép, quần áo, đồng hồ, túi xách, nước hoa).
- Khách duyệt được trang thương hiệu và trang danh mục trên website. Chưa có sản phẩm thì trang hiển thị trạng thái trống.

**Blocked by:** 03 (Phân quyền, quản lý nhân viên và audit log)

**Status:** resolved

- [x] Có sẵn 5 nhóm hàng cố định, là gốc của cây danh mục. Mỗi danh mục gắn với một nhóm hàng; danh mục con phải cùng nhóm hàng với danh mục cha (ADR 0004). Không có danh mục kiểu "Nam/Nữ" trải nhiều nhóm hàng
- [x] Ẩn thương hiệu hoặc danh mục chỉ gỡ khỏi menu, danh sách công khai và trang riêng của nó; không làm ẩn sản phẩm bên trong (sản phẩm chỉ phụ thuộc trạng thái của chính nó)
- [x] Slug của thương hiệu và danh mục là duy nhất. Không tạo được vòng lặp trong cây danh mục
- [x] Không xóa được danh mục còn danh mục con (ở các ticket sau là: còn sản phẩm); chỉ ẩn được
- [x] Mọi thao tác tạo, sửa, ẩn đều ghi audit; thiếu `catalog.edit` thì 403
- [x] API công khai trả về danh sách thương hiệu đang hiển thị và cây danh mục
- [x] Trang quản trị có màn hình CRUD thương hiệu và màn hình cây danh mục. Website có menu danh mục, trang thương hiệu và trang danh mục (SSR, ưu tiên điện thoại)
- [x] Có test qua HTTP cho các trường hợp:
  - slug trùng bị từ chối;
  - danh mục con khác nhóm hàng bị từ chối;
  - tạo vòng lặp trong cây bị từ chối;
  - thương hiệu bị ẩn không xuất hiện ở API công khai;
  - kiểm tra quyền

**Quyết định khi làm (2026-10-23):**
- Nhóm hàng là enum cố định `product_type` (footwear, apparel, watch, bag, fragrance), không phải dòng trong DB; danh mục có `parent_id` null là con trực tiếp của nhóm hàng. Ticket 08 gắn schema thuộc tính theo enum này.
- Nhóm hàng của danh mục cố định từ lúc tạo; đổi cha chỉ trong cùng nhóm hàng. Khác nhóm hàng hoặc tạo vòng lặp thì 409 trên trường `parentId`; cha không tồn tại thì 400.
- Ẩn danh mục thì cả nhánh con cũng biến khỏi cây công khai và trang riêng (404), vì khách không còn đường đi tới nhánh đó. Sản phẩm vẫn không bị ẩn theo. **Cần chủ doanh nghiệp xác nhận** trước ticket 09/12.
- Slug duy nhất trong từng bảng: thương hiệu và danh mục có thể trùng slug vì URL tách tiền tố `/thuong-hieu/` và `/danh-muc/`. Slug sửa được.
- Thương hiệu không có thao tác xóa, chỉ ẩn ("CRUD" hiểu là tạo, xem, sửa, ẩn), vì sản phẩm ở ticket 09 sẽ tham chiếu tới nó. Danh mục xóa được khi không còn con, có ghi audit `catalog.category.delete`.
- Thao tác đổi hình dạng cây (tạo, đổi cha, xóa) xếp hàng bằng `pg_advisory_xact_lock` để hai lần đổi cha cùng lúc không tạo vòng lặp.
- Dùng quyền có sẵn `catalog.edit` (owner, sales, warehouse) cho cả thương hiệu và danh mục.
- Để lại sau code review: gộp helper `slugTaken`/`updateX` lặp giữa hai router và `run()` lặp giữa các trang admin; regex slug lặp ở thuộc tính `pattern` của form admin.
