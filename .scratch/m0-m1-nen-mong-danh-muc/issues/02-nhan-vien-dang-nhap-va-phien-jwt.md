# 02: Nhân viên đăng nhập và phiên JWT

**What to build:**
- Owner đầu tiên được tạo bằng lệnh seed hoặc CLI lúc cài đặt.
- Nhân viên đăng nhập tại `/admin/login` và vào một trang quản trị trống, chỉ hiển thị tên của mình.
- Phiên giữ được qua các lần tải lại trang nhờ refresh token. Phiên tự hết hạn sau 12 giờ. Đăng xuất được.
- Cùng API đó dùng được cho app mobile sau này: refresh token gửi qua body thay vì cookie.

Ticket này dựng lõi xác thực dùng chung. Ticket 05 tái sử dụng lõi này cho miền khách.

**Blocked by:** 01 (Khung chạy được end-to-end)

**Status:** ready-for-agent

- [ ] Bảng `staff` riêng, mật khẩu băm bằng argon2id, có sẵn chỗ cho 2FA nhưng chưa bật; không có endpoint tự đăng ký
- [ ] Lệnh seed/CLI tạo owner đầu tiên, chạy lại không tạo trùng
- [ ] Access token sống 15 phút, audience staff, payload không chứa permission
- [ ] Refresh token sống 12 giờ, lưu dạng hash, có family; mỗi lần refresh cấp token mới và vô hiệu token cũ
- [ ] Dùng lại một refresh token đã dùng thì cả family bị thu hồi, và các refresh sau đó của family đều bị từ chối
- [ ] `X-Client: web`: refresh token nằm trong cookie httpOnly, Secure, SameSite=Strict, path chỉ là endpoint refresh. `X-Client: mobile`: refresh token gửi và nhận qua body
- [ ] Đăng xuất thu hồi refresh token hiện tại
- [ ] Middleware của `/api/admin/*` chỉ chấp nhận access token còn hạn có audience staff
- [ ] Sai email hoặc mật khẩu trả cùng một thông báo, không tiết lộ email có tồn tại hay không
- [ ] Trang `/admin` (SPA) có màn hình đăng nhập, giữ access token trong bộ nhớ, tự refresh khi hết hạn, có nút đăng xuất
- [ ] Có test qua HTTP cho: đăng nhập, refresh có rotation, dùng lại token thì thu hồi family, cả hai kênh web và mobile, đăng xuất
