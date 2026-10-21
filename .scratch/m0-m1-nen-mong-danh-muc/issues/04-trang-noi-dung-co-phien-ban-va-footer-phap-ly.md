# 04: Trang nội dung có phiên bản và footer pháp lý

**What to build:**
- Nhân viên có quyền `content.edit` soạn và xuất bản các trang nội dung: giới thiệu doanh nghiệp, quy trình nhập và kiểm tra hàng, và các chính sách (bảo mật, đổi trả, bảo hành, giao hàng, đặt cọc).
- Mỗi lần xuất bản tạo một phiên bản mới; phiên bản cũ vẫn còn và đọc lại được.
- Khách đọc các trang đã xuất bản trên website.
- Chân trang của website hiển thị thông tin pháp lý của doanh nghiệp và logo đã thông báo Bộ Công Thương, cả hai lấy từ cấu hình hệ thống.

Ticket 05 cần ticket này để lưu khách đã đồng ý với **phiên bản** chính sách bảo mật nào. Ticket 11 cần ticket này để gắn chính sách vào sản phẩm.

**Blocked by:** 03 (Phân quyền, quản lý nhân viên và audit log)

**Status:** ready-for-agent

- [ ] Trang nội dung có: slug duy nhất, tiêu đề, nội dung markdown hoặc rich text, loại (giới thiệu / quy trình / chính sách), trạng thái nháp/xuất bản
- [ ] Xuất bản tạo phiên bản mới có số phiên bản và thời điểm xuất bản. Các phiên bản cũ đọc được qua API
- [ ] API công khai trả về phiên bản đang xuất bản của một trang theo slug. Trang nháp không lộ ra ngoài
- [ ] Có cách lấy phiên bản hiện hành của chính sách bảo mật để các module khác tham chiếu
- [ ] Sửa và xuất bản đều ghi audit; thiếu `content.edit` thì 403
- [ ] Thông tin pháp lý của doanh nghiệp và ảnh logo Bộ Công Thương là cấu hình hệ thống, sửa được trong admin và hiển thị ở chân trang mọi trang
- [ ] Trang quản trị có danh sách trang nội dung, trình soạn, nút xuất bản và lịch sử phiên bản. Website có trang hiển thị nội dung theo slug, render SSR
- [ ] Có test qua HTTP cho các trường hợp:
  - xuất bản tạo phiên bản mới, phiên bản cũ vẫn đọc được;
  - trang nháp không xuất hiện ở API công khai;
  - kiểm tra quyền khi sửa và xuất bản
