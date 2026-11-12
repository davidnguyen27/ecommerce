# 06: Khách quên mật khẩu, đổi mật khẩu, giới hạn tần suất

**What to build:**
- Khách quên mật khẩu thì nhận email có link đặt lại.
- Khách đổi mật khẩu (từ link quên mật khẩu hoặc trong trang tài khoản) thì mọi thiết bị khác bị đăng xuất.
- Đăng nhập và quên mật khẩu được giới hạn tần suất (rate limit) cho cả khách và nhân viên, để chống dò mật khẩu.

**Blocked by:** 05 (Khách đăng ký, đăng nhập, xác minh email)

**Status:** resolved

- [x] Yêu cầu quên mật khẩu luôn trả cùng một phản hồi, dù email có tồn tại hay không. Nếu email tồn tại thì gửi email có token một lần, có hạn
- [x] Đặt lại mật khẩu bằng token hợp lệ thì đổi được mật khẩu. Token đã dùng hoặc hết hạn thì bị từ chối
- [x] Đổi mật khẩu theo bất kỳ cách nào cũng thu hồi mọi refresh token của khách đó
- [x] Giới hạn tần suất cho đăng nhập của khách, đăng nhập của nhân viên và quên mật khẩu, theo IP và theo email. Vượt giới hạn thì trả 429 kèm mã lỗi thống nhất
- [x] Website có trang quên mật khẩu, trang đặt lại mật khẩu và form đổi mật khẩu trong trang tài khoản
- [x] Có test qua HTTP cho các trường hợp:
  - luồng quên rồi đặt lại mật khẩu, lấy link từ mailer giả;
  - dùng lại token đặt lại thì bị từ chối;
  - đổi mật khẩu thì refresh cũ bị từ chối;
  - vượt giới hạn thì 429

**Quyết định khi triển khai (2026-10-23):**
- API khách: `POST /api/auth/forgot-password` (`ForgotPasswordRequest`, luôn 202 không body), `POST /api/auth/reset-password` (`ResetPasswordRequest`, 204; token sai, đã dùng, hết hạn hoặc khác mục đích thì 400 `VALIDATION_ERROR`), `POST /api/account/password` (cần access token khách và header `X-Client`; `ChangePasswordRequest`; sai mật khẩu hiện tại thì 400 kèm `fields` `currentPassword`; thành công trả `AuthTokens` của một phiên mới cho thiết bị đang dùng, như đăng nhập).
- Link đặt lại hạn 1 giờ, dạng `${SITE_URL}/dat-lai-mat-khau?token=…`, lưu ở `customer_token` với purpose `password_reset`. `setCustomerPassword(db, customerId, hash)` (`api/src/customers/password-reset.ts`) là đường duy nhất đổi mật khẩu khách: trong cùng transaction nó thu hồi mọi refresh token của khách và vô hiệu mọi link đặt lại còn dở. Trang đặt lại chỉ dùng token khi khách gửi form, không dùng lúc render SSR (trình quét link trong hộp thư không tiêu mất token).
- Phiên khách: `customerSessions(prisma, secret, mountPath)` trong `routes/customer-auth.ts` được tạo một lần ở `app.ts` và đi qua `CustomerAuthDeps.sessions`, để route tài khoản mở được phiên mới. `customerAuthRoutes(deps)` bỏ tham số `mountPath`; `CustomerAuthDeps` bỏ `secret`. `clientOf` của `session-routes.ts` được export.
- Rate limit: `enforceRateLimits(db, res, hits)` và `RATE_LIMITS` ở `api/src/http/rate-limit.ts`. Bộ đếm cửa sổ cố định trong bảng `rate_limit_bucket` (khóa là SHA-256 của tên giới hạn + IP/email/id, không lưu email dạng đọc được), cập nhật bằng một câu `INSERT … ON CONFLICT` nên mọi instance API dùng chung và request đồng thời không đếm sót. Vượt giới hạn trả 429 với mã lỗi mới `RATE_LIMITED` kèm header `Retry-After` (giây).
- Mức giới hạn: đăng nhập 10 lần/15 phút mỗi email và 50 lần/15 phút mỗi IP, tính riêng cho khách và nhân viên, đếm cả lần đúng mật khẩu và đếm trước khi verify; quên mật khẩu 3 lần/giờ mỗi email và 20 lần/giờ mỗi IP; gửi lại thư xác minh 3 lần/giờ mỗi khách (việc ticket 05 để lại). IP lấy từ `req.ip` (trust proxy loopback và mạng nội bộ, tức là IP do Caddy chuyển tiếp).
- Website: `/quen-mat-khau`, `/dat-lai-mat-khau`, form đổi mật khẩu trong `/tai-khoan` (`useCustomerSession().changePassword`), link "Quên mật khẩu?" ở `/dang-nhap`. `scripts/smoke.ts` có kiểm tra cho hai trang mới. Helper test dùng chung cho khách chuyển sang `api/test/support/customer.ts`.
- Cần chủ doanh nghiệp xác nhận: các mức giới hạn ở trên (giới hạn theo email cũng cho phép người khác cố tình làm một tài khoản tạm thời không đăng nhập được trong tối đa 15 phút); hạn link đặt lại 1 giờ.
- Còn mở: Quên mật khẩu với email có tài khoản tốn thêm một lần ghi DB, nên thời gian phản hồi có thể chênh rất ít so với email không có. Đổi mật khẩu trong trang tài khoản chưa có giới hạn tần suất riêng (đã cần access token còn hạn). Nhân viên chưa có chức năng tự đổi mật khẩu (ngoài phạm vi ticket này).
