# 05: Khách đăng ký, đăng nhập, xác minh email

**What to build:**
- Khách đăng ký tài khoản bằng email và mật khẩu, bắt buộc tick đồng ý chính sách xử lý dữ liệu cá nhân. Hệ thống lưu lại khách đã đồng ý với phiên bản chính sách nào và vào lúc nào.
- Sau khi đăng ký, khách nhận email xác minh. Việc chưa xác minh không chặn khách dùng tài khoản.
- Khách đăng nhập và giữ phiên trên điện thoại tới 30 ngày, đăng xuất được.
- Token của khách không bao giờ truy cập được API quản trị.

Ticket này dùng lại lõi xác thực của ticket 02 cho miền khách. Nó cũng dựng interface mailer: production gửi qua nhà cung cấp email transactional, test ghi vào bộ nhớ, và email được gửi qua job pg-boss.

**Blocked by:** 02 (Nhân viên đăng nhập và phiên JWT), 04 (Trang nội dung có phiên bản và footer pháp lý)

**Status:** ready-for-agent

- [ ] Bảng `customer` tách khỏi bảng `staff`. Access token của khách có audience customer. Refresh token sống 30 ngày, có rotation và thu hồi cả family, hỗ trợ cả kênh web và mobile như ticket 02
- [ ] Đăng ký thiếu tick đồng ý thì bị từ chối. Đăng ký thành công thì lưu lời đồng ý kèm phiên bản chính sách bảo mật hiện hành và thời điểm đồng ý
- [ ] Email trùng thì báo lỗi, nhưng không tiết lộ thông tin gì thêm ngoài lỗi đó
- [ ] Interface mailer có bản giả cho test; email được gửi qua job pg-boss; bản production dùng một nhà cung cấp email transactional, chọn bằng cấu hình
- [ ] Link xác minh email dùng token một lần, có hạn; dùng xong thì tài khoản được đánh dấu đã xác minh
- [ ] Token khách gọi `/api/admin/*` bị 401/403, kể cả khi email của khách trùng với email một nhân viên
- [ ] Website có trang đăng ký, đăng nhập, đăng xuất và trang tài khoản tối giản; mọi trang dùng tốt trên điện thoại
- [ ] Có test qua HTTP cho các trường hợp:
  - đăng ký có và thiếu đồng ý;
  - đọc email xác minh từ mailer giả rồi xác minh;
  - đăng nhập, refresh và đăng xuất;
  - token khách bị chặn ở API quản trị
