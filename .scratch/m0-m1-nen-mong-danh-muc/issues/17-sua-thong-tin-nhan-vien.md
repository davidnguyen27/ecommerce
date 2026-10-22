# 17: Sửa thông tin nhân viên

**What to build:**
- Người có quyền `staff.manage` sửa được tên và email của một nhân viên trong trang quản trị.
- Nhân viên không bao giờ bị xóa; muốn thôi cho truy cập thì khóa tài khoản (ticket 03).

**Blocked by:** 03 (Phân quyền, quản lý nhân viên và audit log)

**Status:** ready-for-agent

- [ ] Endpoint sửa tên, email nhân viên yêu cầu `staff.manage`; thiếu quyền thì 403
- [ ] Email được chuẩn hóa như lúc tạo và phải duy nhất; trùng thì 409 kèm lỗi theo trường `email`
- [ ] Đổi email thì thu hồi mọi refresh token của người đó
- [ ] Mỗi lần sửa ghi audit `staff.update` với dữ liệu trước/sau, trong cùng transaction; sửa mà không thay đổi gì thì không ghi audit
- [ ] Không có endpoint xóa nhân viên
- [ ] Trang danh sách nhân viên có thao tác sửa tên, email
- [ ] Có test qua HTTP cho các trường hợp:
  - sửa thành công ghi audit có trước/sau;
  - email trùng bị từ chối và không để lại audit;
  - đổi email thì refresh token cũ bị từ chối;
  - thiếu `staff.manage` thì 403
