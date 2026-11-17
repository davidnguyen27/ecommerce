# 02: Ảnh đính kèm trong yêu cầu hỗ trợ

**What to build:**
- Khách và nhân viên đính kèm được ảnh vào yêu cầu và vào tin nhắn.
- Ảnh là riêng tư: chỉ người xem được yêu cầu mới mở được, qua link có hạn.
- Đây là lần đầu khách tải được file lên hệ thống, nên kiểm chặt loại file, kích thước và tần suất.

**Blocked by:** 01

**Status:** resolved

- [x] Migration bảng `support_attachment` theo spec.
- [x] Tải ảnh:
  - JPEG/PNG/WebP, ≤ 5 MB mỗi ảnh, tối đa 5 ảnh mỗi tin và 20 ảnh mỗi yêu cầu;
  - kiểm loại bằng nội dung file, không tin `Content-Type`;
  - xử lý lại ảnh để bỏ metadata. Dùng lại cách xử lý ảnh sản phẩm nếu có; không có thì ghi rõ cách làm trong quyết định;
  - lưu ở bucket `private`.
- [x] Endpoint tải ảnh cho khách (tài khoản và token đơn) và cho admin. Giới hạn 20 ảnh/giờ/IP với khách.
- [x] Chi tiết yêu cầu trả ảnh kèm URL ký 5 phút (`storage.signedUrl`), chỉ cho người xem được yêu cầu.
- [x] Web: chọn ảnh khi gửi yêu cầu và khi gửi tin (xem trước, bỏ được); hiện ảnh trong chuỗi tin ở cả hai phía.
- [x] Test:
  - ảnh đúng loại thì nhận;
  - file đuôi ảnh nhưng nội dung khác thì 400;
  - quá cỡ, quá số ảnh mỗi tin hay mỗi yêu cầu thì 400;
  - khách khác không lấy được URL (404);
  - quá tần suất thì 429.

Spec: mục "Ảnh đính kèm".

**Quyết định khi triển khai (2026-11-17):**
- **Ảnh luôn gắn vào một tin.** `support_attachment.message_id` bắt buộc, khác với spec ghi "có thể trống".
  - Web gửi tin trước, rồi tải từng ảnh vào tin đó: `POST …/messages/:messageId/attachments`, mỗi lần một file ở trường `file`. Ảnh lúc tạo yêu cầu gắn vào tin đầu tiên.
  - Không làm kiểu "tải trước rồi gắn sau", vì như vậy phải theo dõi và dọn các ảnh mồ côi của khách vãng lai.
- **Điều kiện gắn ảnh**, kiểm dưới khóa dòng yêu cầu:
  - chỉ gắn vào tin của chính mình (khách vào tin của khách; nhân viên vào tin của chính nhân viên đó);
  - trong 30 phút sau khi gửi tin (`ATTACH_WINDOW_MS`);
  - yêu cầu chưa kết thúc.

  Tin lạ hay tin của người khác thì 404; quá hạn, đã kết thúc hay quá số ảnh thì 409. Ảnh gắn vào ghi chú nội bộ cũng không lộ cho khách.
- `api/src/media/support-images.ts`:
  - dùng `receiveFile` (multer, quá 5 MB thì **413** như mọi upload khác, không phải 400 như ticket ghi);
  - kiểm loại thật bằng `sharp` (jpeg, png, webp);
  - mã hóa lại cùng định dạng để bỏ EXIF và GPS, xoay theo chiều chụp, thu cạnh dài về tối đa 2000px;
  - lưu ở bucket `private`, khóa `support/<id yêu cầu>/<uuid>.<đuôi>`.

  Ảnh được lưu **trước** transaction ghi bản ghi; transaction lỗi thì xóa file (lỗi xóa chỉ ghi log).
- Giới hạn: 5 ảnh/tin, 20 ảnh/yêu cầu (đếm dưới khóa), `support-image:ip` 20/giờ với khách. Nhân viên không bị giới hạn tần suất.
- Chi tiết yêu cầu (khách và admin) trả `attachments` của từng tin kèm URL ký 5 phút (`DOCUMENT_URL_TTL_SECONDS`). Vì vậy `toPublicSupport`/`toAdminSupport` thành hàm async nhận `storage`; `adminSupportRoutes` nhận thêm `storage`.
- Audit `support.attach` cho ảnh của nhân viên. Ảnh của khách không có audit, vì không phải thao tác admin; ảnh đã nằm trong chuỗi tin.
- Repo không đặt Content-Security-Policy, nên ảnh từ URL ký của bucket private hiện được ở web.
- Web:
  - `SupportImagePicker.vue`: chọn tối đa 5 ảnh, kiểm sơ bộ loại và kích thước ở trình duyệt, xem trước, bỏ từng ảnh;
  - `SupportAttachments.vue`: ảnh nhỏ, bấm mở ảnh lớn;
  - `attachAll` tải lần lượt; ảnh nào lỗi thì báo, tin vẫn giữ. Tạo yêu cầu mà ảnh lỗi thì ở lại form, kèm link mở yêu cầu đã gửi;
  - dùng ở form tạo yêu cầu, ô trả lời của khách và trang chi tiết ở admin.
- Test `api/test/support-attachments.test.ts` (9 test). Chưa chạy thử giao diện trên trình duyệt; E2E ở ticket 07.
- Kết quả: cả bộ test API lần đầu có 10 test lỗi rải ở 9 file (đa số không liên quan, như SEO, dọn token); chạy lại riêng 9 file đó thì qua 47/47, tức là Docker Desktop chập chờn.
