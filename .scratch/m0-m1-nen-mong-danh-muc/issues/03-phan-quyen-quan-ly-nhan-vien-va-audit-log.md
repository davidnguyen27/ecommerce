# 03: Phân quyền, quản lý nhân viên và audit log

**What to build:**
- Owner vào trang quản trị để tạo nhân viên, gán một hoặc nhiều role (owner, sales, warehouse, accountant), đổi role và khóa tài khoản.
- Nhân viên chỉ thấy và gọi được những chức năng role của họ cho phép.
- Đổi role có hiệu lực ngay ở request kế tiếp, kể cả khi access token của người đó vẫn còn hạn.
- Khóa tài khoản làm mọi phiên của người đó mất hiệu lực.
- Mọi thao tác trên nhân viên được ghi vào audit log append-only. Owner xem và lọc được audit log trong trang quản trị.

Ticket này tạo ra cơ chế khai báo permission cho endpoint và cơ chế ghi audit trong cùng transaction. Mọi ticket quản trị sau đều dùng lại hai cơ chế này.

**Blocked by:** 02 (Nhân viên đăng nhập và phiên JWT)

**Status:** ready-for-agent

- [ ] Bốn role cố định, mỗi role ánh xạ tới một tập permission định nghĩa trong code: `staff.manage`, `catalog.edit`, `price.edit`, `media.upload`, `document.view`, `content.edit`, `audit.view`. Owner có tất cả
- [ ] Permission được tính từ role hiện tại đọc trong DB ở mỗi request. Endpoint quản trị khai báo permission cần có; thiếu quyền trả 403 kèm mã lỗi thống nhất
- [ ] Người có `staff.manage` tạo được nhân viên, gán và đổi role, khóa và mở khóa tài khoản
- [ ] Khóa tài khoản hoặc đổi role thì thu hồi mọi refresh token của người đó. Tài khoản bị khóa không đăng nhập và không refresh được
- [ ] Audit log lưu: người thực hiện, hành động, loại và id đối tượng, dữ liệu trước/sau, IP, user agent, thời điểm. Bản ghi được ghi trong cùng transaction với thay đổi nghiệp vụ
- [ ] Không có endpoint sửa hay xóa audit. Endpoint đọc yêu cầu `audit.view`, lọc được theo người, loại đối tượng và khoảng thời gian, có phân trang
- [ ] Trang quản trị có danh sách nhân viên (tạo, đổi role, khóa) và trang xem audit có bộ lọc. Menu chỉ hiện những mục người dùng có quyền
- [ ] Có test qua HTTP cho các trường hợp:
  - thiếu permission thì 403;
  - đổi role có hiệu lực ngay với access token cũ;
  - khóa tài khoản thì refresh bị từ chối;
  - thao tác lỗi hoặc rollback thì không để lại bản ghi audit;
  - không có cách sửa hay xóa audit
