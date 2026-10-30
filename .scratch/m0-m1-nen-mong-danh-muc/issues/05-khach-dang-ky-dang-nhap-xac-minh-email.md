# 05: Khách đăng ký, đăng nhập, xác minh email

**What to build:**
- Khách đăng ký tài khoản bằng email và mật khẩu, bắt buộc tick đồng ý chính sách xử lý dữ liệu cá nhân. Hệ thống lưu lại khách đã đồng ý với phiên bản chính sách nào và vào lúc nào.
- Sau khi đăng ký, khách nhận email xác minh. Việc chưa xác minh không chặn khách dùng tài khoản.
- Khách đăng nhập và giữ phiên trên điện thoại tới 30 ngày, đăng xuất được.
- Token của khách không bao giờ truy cập được API quản trị.

Ticket này dùng lại lõi xác thực của ticket 02 cho miền khách. Nó cũng dựng interface mailer: production gửi qua nhà cung cấp email transactional, test ghi vào bộ nhớ, và email được gửi qua job pg-boss.

**Blocked by:** 02 (Nhân viên đăng nhập và phiên JWT), 04 (Trang nội dung có phiên bản và footer pháp lý)

**Status:** resolved

- [x] Bảng `customer` tách khỏi bảng `staff`. Access token của khách có audience customer. Refresh token sống 30 ngày, có rotation và thu hồi cả family, hỗ trợ cả kênh web và mobile như ticket 02
- [x] Đăng ký thiếu tick đồng ý thì bị từ chối. Đăng ký thành công thì lưu lời đồng ý kèm phiên bản chính sách bảo mật hiện hành và thời điểm đồng ý
- [x] Email trùng thì báo lỗi, nhưng không tiết lộ thông tin gì thêm ngoài lỗi đó
- [x] Interface mailer có bản giả cho test; email được gửi qua job pg-boss; bản production dùng một nhà cung cấp email transactional, chọn bằng cấu hình
- [x] Link xác minh email dùng token một lần, có hạn; dùng xong thì tài khoản được đánh dấu đã xác minh
- [x] Token khách gọi `/api/admin/*` bị 401/403, kể cả khi email của khách trùng với email một nhân viên
- [x] Website có trang đăng ký, đăng nhập, đăng xuất và trang tài khoản tối giản; mọi trang dùng tốt trên điện thoại
- [x] Có test qua HTTP cho các trường hợp:
  - đăng ký có và thiếu đồng ý;
  - đọc email xác minh từ mailer giả rồi xác minh;
  - đăng nhập, refresh và đăng xuất;
  - token khách bị chặn ở API quản trị

**Quyết định khi triển khai (2026-10-23):**
- API khách: `POST /api/auth/register` (201, trả token như đăng nhập, tức là đăng ký xong là đăng nhập luôn), `POST /api/auth/login`, `POST /api/auth/refresh`, `DELETE /api/auth/refresh` (đăng xuất), `POST /api/auth/verify-email` (204; token sai, đã dùng hoặc hết hạn thì 400 `VALIDATION_ERROR`). Cần access token khách: `GET /api/account/me` (`CustomerProfile`), `POST /api/account/email-verification` (gửi lại thư, 202; đã xác minh thì 204 và không gửi). Cookie refresh tên `customer_refresh`, path `/api/auth/refresh`. Schema shared: `RegisterRequest` (`acceptPrivacyPolicy: true`), `VerifyEmailRequest`, `CustomerProfile`, `CUSTOMER_PASSWORD_MIN_LENGTH`.
- Lõi phiên của ticket 02 đổi thành `createSessions(options)` trong `api/src/auth/session-routes.ts`, trả `{ routes, start }`; `start(req, res, subjectId, status)` mở phiên cho route khác (đăng ký). `newOpaqueToken`/`hashOpaqueToken` tách ra `api/src/auth/opaque-token.ts` để token gửi qua email dùng chung.
- Lời đồng ý nằm ở bảng riêng `customer_consent` (khách, id phiên bản chính sách, thời điểm), append-only bằng trigger như `content_page_version`, để sau này đồng ý lại bản mới thì thêm dòng. Phiên bản lấy bằng `findCurrentPrivacyPolicy` trong cùng transaction tạo tài khoản. Chưa có chính sách bảo mật đã xuất bản thì đăng ký trả 503 `SERVICE_UNAVAILABLE`.
- Token một lần lưu ở `customer_token` (hash SHA-256, `purpose`, hạn, `used_at`); ticket 06 thêm giá trị `password_reset` vào enum `customer_token_purpose`. Link xác minh hạn 48 giờ, dạng `${SITE_URL}/xac-minh-email?token=…`; trang này gọi API khi render SSR.
- Email: `Jobs` (`api/src/jobs/jobs.ts`) bọc pg-boss, queue `send-email` (thử lại 5 lần, giãn dần). Route gọi `emails.sendEmail(tx, mail)`; job được ghi bằng chính transaction đó (`fromPrisma`), nên đăng ký rollback thì không có thư. `AppDeps` bỏ `mailer`, thêm `emails: EmailQueue` và `siteUrl`; mailer chỉ còn worker dùng. Test chạy pg-boss thật trên DB của từng test (schema pg-boss cài sẵn vào DB template) và đọc thư từ `InMemoryMailer` bằng `vi.waitFor`.
- Cấu hình API mới: `SITE_URL` (bắt buộc), `MAIL_PROVIDER=resend|log` (bắt buộc), `RESEND_API_KEY`, `MAIL_FROM`. docker-compose mặc định `log` (ghi thư ra log, không gửi). Dependency mới: `pg-boss`.
- Mật khẩu khách tối thiểu 8 ký tự (nhân viên 12). Email lưu chữ thường, trùng email (kể cả khác hoa thường) trả 409 `CONFLICT` "Email này đã được đăng ký"; email trùng với nhân viên vẫn đăng ký được (ADR 0001).
- Website: `/dang-ky`, `/dang-nhap`, `/tai-khoan` (email, trạng thái xác minh, nút gửi lại thư, phiên bản và thời điểm đồng ý, nút đăng xuất), `/xac-minh-email`; header có link "Tài khoản". Phiên khách giữ ở trình duyệt (`useCustomerSession`): cookie refresh chỉ gửi tới `/api/auth/refresh` nên server Nuxt không biết khách là ai, vì vậy trang tài khoản nạp dữ liệu sau khi mount thay vì `useAsyncData` (lệch có chủ đích so với CODING_STANDARDS "Web"). `scripts/smoke.ts` có kiểm tra cho các trang mới.
- Cần chủ doanh nghiệp xác nhận: nhà cung cấp email transactional là Resend (chỉ cần đổi lớp `ResendMailer` nếu chọn bên khác), và việc chưa có chính sách bảo mật thì chặn đăng ký.
- Còn mở: gửi lại thư xác minh chưa bị giới hạn tần suất (rate limit thuộc ticket 06). Thư chỉ có bản text, chưa có HTML.
- Sau review toàn nhánh (2026-10-30): job pg-boss `delete-expired` chạy 3 giờ sáng mỗi đêm (giờ Việt Nam), xóa `refresh_token`, `customer_token` đã hết hạn và `rate_limit_bucket` đã qua cửa sổ dài nhất (`api/src/jobs/cleanup.ts`).
