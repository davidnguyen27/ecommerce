# 02: Nhân viên đăng nhập và phiên JWT

**What to build:**
- Owner đầu tiên được tạo bằng lệnh seed hoặc CLI lúc cài đặt.
- Nhân viên đăng nhập tại `/admin/login` và vào một trang quản trị trống, chỉ hiển thị tên của mình.
- Phiên giữ được qua các lần tải lại trang nhờ refresh token. Phiên tự hết hạn sau 12 giờ. Đăng xuất được.
- Cùng API đó dùng được cho app mobile sau này: refresh token gửi qua body thay vì cookie.

Ticket này dựng lõi xác thực dùng chung. Ticket 05 tái sử dụng lõi này cho miền khách.

**Blocked by:** 01 (Khung chạy được end-to-end)

**Status:** resolved

- [x] Bảng `staff` riêng, mật khẩu băm bằng argon2id, có sẵn chỗ cho 2FA nhưng chưa bật; không có endpoint tự đăng ký
- [x] Lệnh seed/CLI tạo owner đầu tiên, chạy lại không tạo trùng
- [x] Access token sống 15 phút, audience staff, payload không chứa permission
- [x] Refresh token sống 12 giờ, lưu dạng hash, có family; mỗi lần refresh cấp token mới và vô hiệu token cũ
- [x] Dùng lại một refresh token đã dùng thì cả family bị thu hồi, và các refresh sau đó của family đều bị từ chối
- [x] `X-Client: web`: refresh token nằm trong cookie httpOnly, Secure, SameSite=Strict, path chỉ là endpoint refresh. `X-Client: mobile`: refresh token gửi và nhận qua body
- [x] Đăng xuất thu hồi refresh token hiện tại
- [x] Middleware của `/api/admin/*` chỉ chấp nhận access token còn hạn có audience staff
- [x] Sai email hoặc mật khẩu trả cùng một thông báo, không tiết lộ email có tồn tại hay không
- [x] Trang `/admin` (SPA) có màn hình đăng nhập, giữ access token trong bộ nhớ, tự refresh khi hết hạn, có nút đăng xuất
- [x] Có test qua HTTP cho: đăng nhập, refresh có rotation, dùng lại token thì thu hồi family, cả hai kênh web và mobile, đăng xuất

## Comments

**2026-10-21:** Hoàn thành ở commit `ff21930`. Đã kiểm tra bằng chạy thật:
- `pnpm lint`, `pnpm typecheck`, `pnpm test` ở gốc repo đều xanh (25 test, trong đó 16 test xác thực qua HTTP).
- `docker compose up --build`: `pnpm seed:owner` chạy hai lần chỉ tạo một owner; qua Caddy, đăng nhập kênh web đặt cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/admin/auth/refresh`, refresh trả 200, đăng xuất trả 204 rồi refresh bị 401. Màn hình `/admin/login` và trang `/admin` (tự refresh khi tải lại, đăng xuất) đã được kiểm tra trên trình duyệt.
- Hạn phiên 12 giờ là tuyệt đối từ lúc đăng nhập: token mới khi rotation kế thừa hạn của family. Hai mốc 15 phút và 12 giờ không có test tự động vì app chưa nhận đồng hồ tiêm vào.
- Đăng xuất là `DELETE /api/admin/auth/refresh`, để cookie chỉ gửi tới endpoint refresh vẫn tới được.
- Để lại cho ticket sau: thu hồi mọi refresh token khi khóa tài khoản hoặc đổi role (03), khi đổi mật khẩu và rate limit đăng nhập (06). Mở hai tab quản trị cùng tải lại một lúc sẽ bị coi là dùng lại refresh token và thu hồi cả family; cần quyết định có thêm khoảng ân hạn ngắn hay không.
