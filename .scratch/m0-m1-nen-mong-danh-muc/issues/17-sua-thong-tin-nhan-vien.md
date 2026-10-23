# 17: Sửa thông tin nhân viên

**What to build:**
- Người có quyền `staff.manage` sửa được tên và email của một nhân viên trong trang quản trị.
- Nhân viên không bao giờ bị xóa; muốn thôi cho truy cập thì khóa tài khoản (ticket 03).

**Blocked by:** 03 (Phân quyền, quản lý nhân viên và audit log)

**Status:** resolved

- [x] Endpoint sửa tên, email nhân viên yêu cầu `staff.manage`; thiếu quyền thì 403
- [x] Email được chuẩn hóa như lúc tạo và phải duy nhất; trùng thì 409 kèm lỗi theo trường `email`
- [x] Đổi email thì thu hồi mọi refresh token của người đó
- [x] Mỗi lần sửa ghi audit `staff.update` với dữ liệu trước/sau, trong cùng transaction; sửa mà không thay đổi gì thì không ghi audit
- [x] Không có endpoint xóa nhân viên
- [x] Trang danh sách nhân viên có thao tác sửa tên, email
- [x] Có test qua HTTP cho các trường hợp:
  - sửa thành công ghi audit có trước/sau;
  - email trùng bị từ chối và không để lại audit;
  - đổi email thì refresh token cũ bị từ chối;
  - thiếu `staff.manage` thì 403

**Quyết định khi triển khai (2026-10-23):**
- Route `PUT /api/admin/staff/:id` với body `UpdateStaffRequest` (`{ name, email }`, cả hai bắt buộc, trong `@ecommerce/shared`), trả `StaffSummary`. Dùng quyền có sẵn `staff.manage` (khai báo ở cấp router), không thêm quyền mới.
- Đi qua helper `updateStaff` chung với đổi role/khóa, nên vẫn giữ kiểm tra "còn ít nhất một owner". Helper giờ chỉ thu hồi phiên khi email, role hoặc trạng thái khóa đổi; chỉ đổi tên thì giữ phiên.
- Email trùng bị unique index chặn (P2002): transaction rollback rồi trả 409 `CONFLICT` với `fields: [{ path: 'email' }]`, không kiểm tra trước rồi mới ghi.
- Người có `staff.manage` sửa được tên, email của chính mình (đổi email của mình thì phiên của mình cũng bị thu hồi).
