# 02: Ảnh đính kèm trong yêu cầu hỗ trợ

**What to build:**
- Khách và nhân viên đính kèm được ảnh vào yêu cầu và vào tin nhắn.
- Ảnh là riêng tư: chỉ người xem được yêu cầu mới mở được, qua link có hạn.
- Đây là lần đầu khách tải được file lên hệ thống, nên kiểm chặt loại file, kích thước và tần suất.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Migration bảng `support_attachment` theo spec.
- [ ] Tải ảnh:
  - JPEG/PNG/WebP, ≤ 5 MB mỗi ảnh, tối đa 5 ảnh mỗi tin và 20 ảnh mỗi yêu cầu;
  - kiểm loại bằng nội dung file, không tin `Content-Type`;
  - xử lý lại ảnh để bỏ metadata. Dùng lại cách xử lý ảnh sản phẩm nếu có; không có thì ghi rõ cách làm trong quyết định;
  - lưu ở bucket `private`.
- [ ] Endpoint tải ảnh cho khách (tài khoản và token đơn) và cho admin. Giới hạn 20 ảnh/giờ/IP với khách.
- [ ] Chi tiết yêu cầu trả ảnh kèm URL ký 5 phút (`storage.signedUrl`), chỉ cho người xem được yêu cầu.
- [ ] Web: chọn ảnh khi gửi yêu cầu và khi gửi tin (xem trước, bỏ được); hiện ảnh trong chuỗi tin ở cả hai phía.
- [ ] Test:
  - ảnh đúng loại thì nhận;
  - file đuôi ảnh nhưng nội dung khác thì 400;
  - quá cỡ, quá số ảnh mỗi tin hay mỗi yêu cầu thì 400;
  - khách khác không lấy được URL (404);
  - quá tần suất thì 429.

Spec: mục "Ảnh đính kèm".
