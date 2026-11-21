# 05: Chuyển nhân viên

**What to build:** Từ khung chat, khách xác nhận chuyển và tạo một yêu cầu hỗ trợ loại "khác" do chatbot tạo. Khách đã đăng nhập thì gắn tài khoản; khách vãng lai chỉ cần tên và email, nhận email kèm link theo dõi riêng. Nhân viên đọc được bản chép cuộc trò chuyện ngay trong yêu cầu.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Migration:
  - `SupportAuthor` thêm `chatbot`;
  - check `support_request`: loại `other` có đơn, hoặc tài khoản, hoặc email liên hệ do chatbot tạo; các loại khác vẫn bắt buộc đơn;
  - token tra cứu của yêu cầu, lưu dạng băm như `order_lookup_token`;
  - liên kết cuộc trò chuyện ↔ yêu cầu.
- [ ] `POST /api/chat/conversations/:id/handoff`: tên, email (khách vãng lai), lời nhắn. Tiêu đề lấy tóm tắt của model, cắt 120 ký tự.
  - mỗi cuộc chuyển một lần (409);
  - `RATE_LIMITS`: 3 lần chuyển mỗi IP mỗi ngày;
  - tối đa 3 yêu cầu chưa kết thúc mỗi email liên hệ (409).
- [ ] Email "đã nhận yêu cầu" cho khách vãng lai kèm link `/yeu-cau/:code?token=…`.
- [ ] Trang `/yeu-cau/[code]` cho khách vãng lai: đọc, trả lời, đính ảnh, dùng lại thành phần của trang yêu cầu M6b; token sai là 404.
- [ ] Khung chat: form chuyển, rồi hiện câu thời gian phản hồi từ cài đặt.
- [ ] Trang yêu cầu của nhân viên: khối "Cuộc trò chuyện với chatbot", chỉ cần `support.handle`.
- [ ] Job xóa cuộc trò chuyện (ticket 02) giữ lại cuộc đã gắn yêu cầu hỗ trợ.
- [ ] Test:
  - khách vãng lai tạo được yêu cầu không đơn, không tài khoản; email có link token; token sai là 404;
  - đã đăng nhập thì gắn tài khoản; người tạo là `chatbot`;
  - giới hạn một lần mỗi cuộc, 3 mỗi IP mỗi ngày, 3 yêu cầu mở mỗi email;
  - check DB chặn loại khác `other` không có đơn;
  - nhân viên `support.handle` đọc được bản chép; không có quyền thì không.

Spec: "Chuyển nhân viên (mở rộng M6b)".

## Comments

- Ghi chú từ ticket 04: trang `web/app/pages/yeu-cau/[code].vue` đã có từ M6b, mở yêu cầu bằng `?don=<mã đơn>&token=<token tra cứu đơn>`. Link cho khách vãng lai không có đơn phải dùng chung trang này với một kiểu token khác, không tạo trang mới trùng đường dẫn.
