# 06: Khách quên mật khẩu, đổi mật khẩu, giới hạn tần suất

**What to build:**
- Khách quên mật khẩu thì nhận email có link đặt lại.
- Khách đổi mật khẩu (từ link quên mật khẩu hoặc trong trang tài khoản) thì mọi thiết bị khác bị đăng xuất.
- Đăng nhập và quên mật khẩu được giới hạn tần suất (rate limit) cho cả khách và nhân viên, để chống dò mật khẩu.

**Blocked by:** 05 (Khách đăng ký, đăng nhập, xác minh email)

**Status:** ready-for-agent

- [ ] Yêu cầu quên mật khẩu luôn trả cùng một phản hồi, dù email có tồn tại hay không. Nếu email tồn tại thì gửi email có token một lần, có hạn
- [ ] Đặt lại mật khẩu bằng token hợp lệ thì đổi được mật khẩu. Token đã dùng hoặc hết hạn thì bị từ chối
- [ ] Đổi mật khẩu theo bất kỳ cách nào cũng thu hồi mọi refresh token của khách đó
- [ ] Giới hạn tần suất cho đăng nhập của khách, đăng nhập của nhân viên và quên mật khẩu, theo IP và theo email. Vượt giới hạn thì trả 429 kèm mã lỗi thống nhất
- [ ] Website có trang quên mật khẩu, trang đặt lại mật khẩu và form đổi mật khẩu trong trang tài khoản
- [ ] Có test qua HTTP cho các trường hợp:
  - luồng quên rồi đặt lại mật khẩu, lấy link từ mailer giả;
  - dùng lại token đặt lại thì bị từ chối;
  - đổi mật khẩu thì refresh cũ bị từ chối;
  - vượt giới hạn thì 429
