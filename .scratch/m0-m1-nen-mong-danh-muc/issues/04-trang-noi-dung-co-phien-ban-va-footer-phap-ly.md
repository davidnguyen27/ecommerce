# 04: Trang nội dung có phiên bản và footer pháp lý

**What to build:**
- Nhân viên có quyền `content.edit` soạn và xuất bản các trang nội dung: giới thiệu doanh nghiệp, quy trình nhập và kiểm tra hàng, và các chính sách (bảo mật, đổi trả, bảo hành, giao hàng, đặt cọc).
- Mỗi lần xuất bản tạo một phiên bản mới; phiên bản cũ vẫn còn và đọc lại được.
- Khách đọc các trang đã xuất bản trên website.
- Chân trang của website hiển thị thông tin pháp lý của doanh nghiệp và logo đã thông báo Bộ Công Thương, cả hai lấy từ cấu hình hệ thống.

Ticket 05 cần ticket này để lưu khách đã đồng ý với **phiên bản** chính sách bảo mật nào. Ticket 11 cần ticket này để gắn chính sách vào sản phẩm.

**Blocked by:** 03 (Phân quyền, quản lý nhân viên và audit log)

**Status:** resolved

- [x] Trang nội dung có: slug duy nhất, tiêu đề, nội dung markdown hoặc rich text, loại (giới thiệu / quy trình / chính sách), trạng thái nháp/xuất bản
- [x] Xuất bản tạo phiên bản mới có số phiên bản và thời điểm xuất bản. Các phiên bản cũ đọc được qua API
- [x] API công khai trả về phiên bản đang xuất bản của một trang theo slug. Trang nháp không lộ ra ngoài
- [x] Có cách lấy phiên bản hiện hành của chính sách bảo mật để các module khác tham chiếu
- [x] Sửa và xuất bản đều ghi audit; thiếu `content.edit` thì 403
- [x] Thông tin pháp lý của doanh nghiệp và ảnh logo Bộ Công Thương là cấu hình hệ thống, sửa được trong admin và hiển thị ở chân trang mọi trang
- [x] Trang quản trị có danh sách trang nội dung, trình soạn, nút xuất bản và lịch sử phiên bản. Website có trang hiển thị nội dung theo slug, render SSR
- [x] Có test qua HTTP cho các trường hợp:
  - xuất bản tạo phiên bản mới, phiên bản cũ vẫn đọc được;
  - trang nháp không xuất hiện ở API công khai;
  - kiểm tra quyền khi sửa và xuất bản

**Quyết định khi triển khai (2026-10-23):**
- Slug và loại trang cố định từ lúc tạo; sửa chỉ đổi tiêu đề và nội dung (markdown). Nhờ vậy URL và module khác tham chiếu theo slug ổn định, và khách không thấy giá trị nào của bản đang soạn.
- Trạng thái suy ra từ phiên bản: `draft` khi chưa xuất bản lần nào, `published` khi có ít nhất một phiên bản; `hasUnpublishedChanges` khi bản đang soạn khác phiên bản mới nhất. Xuất bản khi không có gì thay đổi thì trả lại phiên bản hiện có, không tạo phiên bản trùng, không ghi audit.
- `content_page_version` append-only bằng trigger, giống `audit_log`. Phiên bản cũ đọc qua `GET /api/admin/pages/:id/versions[/:version]`, cần `content.edit`.
- Chính sách bảo mật là trang loại `policy` có slug `PRIVACY_POLICY_SLUG = 'chinh-sach-bao-mat'` (`@ecommerce/shared`). Ticket 05 dùng `findCurrentPrivacyPolicy` trong `api/src/content/pages.ts`, hàm này trả `null` khi trang chưa được tạo hoặc chưa xuất bản. Hệ thống không tự tạo trang này; trang quản trị nhắc khi còn thiếu.
- API công khai: `GET /api/pages`, `GET /api/pages/:slug`, `GET /api/legal-info`. Website: `/trang/[slug]`, render SSR. Chân trang (`layouts/default.vue`, kể cả trang lỗi) hiện thông tin pháp lý, logo Bộ Công Thương và liên kết tới các trang đã xuất bản.
- Thông tin pháp lý lưu trong bảng `system_config` (khóa `legal_info`), sửa bằng quyền `content.edit`, ghi audit `legal_info.change`. Logo Bộ Công Thương là đường dẫn ảnh kèm đường dẫn hồ sơ trên online.gov.vn; chưa có upload vì luồng upload thuộc ticket 10.
- Đã sửa `web/app/app.vue` thiếu `<NuxtLayout>`; trước đó không layout nào được render, kể cả layout quản trị.
- Còn mở: hai người cùng sửa một trang thì người lưu sau ghi đè (chưa có khóa lạc quan). "Trang nội dung" chưa có trong GLOSSARY; trạng thái Nháp/Đã xuất bản ở đó hiện mới định nghĩa cho sản phẩm.
