# 05: Chuyển nhân viên

**What to build:** Từ khung chat, khách xác nhận chuyển và tạo một yêu cầu hỗ trợ loại "khác" do chatbot tạo. Khách đã đăng nhập thì gắn tài khoản; khách vãng lai chỉ cần tên và email, nhận email kèm link theo dõi riêng. Nhân viên đọc được bản chép cuộc trò chuyện ngay trong yêu cầu.

**Blocked by:** 04

**Status:** resolved

- [x] Migration:
  - `SupportAuthor` thêm `chatbot`;
  - check `support_request`: loại `other` có đơn, hoặc tài khoản, hoặc email liên hệ do chatbot tạo; các loại khác vẫn bắt buộc đơn;
  - token tra cứu của yêu cầu, lưu dạng băm như `order_lookup_token` (bảng `support_request_token`, mỗi email một token);
  - liên kết cuộc trò chuyện ↔ yêu cầu.
- [x] `POST /api/chat/handoff` (đổi đường dẫn, xem quyết định): mã cuộc (không bắt buộc), tên, email (khách vãng lai), lời nhắn. Tiêu đề lấy tóm tắt của model, cắt 120 ký tự.
  - mỗi cuộc chuyển một lần (409);
  - `RATE_LIMITS`: 3 lần chuyển mỗi IP mỗi ngày;
  - tối đa 3 yêu cầu chưa kết thúc mỗi email liên hệ (409).
- [x] Email "đã nhận yêu cầu" cho khách vãng lai kèm link `/yeu-cau/:code?token=…`.
- [x] Trang `/yeu-cau/[code]` cho khách vãng lai: đọc, trả lời, đính ảnh, dùng lại thành phần của trang yêu cầu M6b; token sai là 404.
- [x] Khung chat: form chuyển, rồi hiện câu thời gian phản hồi từ cài đặt.
- [x] Trang yêu cầu của nhân viên: khối "Cuộc trò chuyện với chatbot", chỉ cần `support.handle`.
- [x] Job xóa cuộc trò chuyện (ticket 02) giữ lại cuộc đã gắn yêu cầu hỗ trợ.
- [x] Test:
  - khách vãng lai tạo được yêu cầu không đơn, không tài khoản; email có link token; token sai là 404;
  - đã đăng nhập thì gắn tài khoản; người tạo là `chatbot`;
  - giới hạn một lần mỗi cuộc, 3 mỗi IP mỗi ngày, 3 yêu cầu mở mỗi email;
  - check DB chặn loại khác `other` không có đơn;
  - nhân viên `support.handle` đọc được bản chép; không có quyền thì không.

Spec: "Chuyển nhân viên (mở rộng M6b)".

## Quyết định khi triển khai

- **`POST /api/chat/handoff` thay cho `/api/chat/conversations/:id/handoff`**, mã cuộc trò chuyện không bắt buộc. Chatbot tắt hay hết lượt thì có thể chưa có cuộc nào, mà spec yêu cầu khách vẫn gửi được cho nhân viên. Không có cuộc thì phải có lời nhắn (400).
- **Token của yêu cầu là bảng riêng `support_request_token`** (như `order_lookup_token`), không phải một cột trên yêu cầu: mỗi email tạo token mới (`requestUrl` trong `support/emails.ts`), nên một yêu cầu có nhiều token. Khách mở qua `/api/support-requests/:code?token=…` (`contactSupportRoutes`, dùng chung bộ route khách của M6b; không tạo yêu cầu mới qua đường này).
- **Ràng buộc DB:** `support_request_order_check` cho phép yêu cầu không đơn, không tài khoản khi `created_by = 'chatbot'`; loại khác "khác" vẫn bắt buộc đơn. So sánh qua `::text` vì giá trị enum vừa thêm chưa dùng làm hằng được trong cùng transaction.
- **Liên hệ (tên, email)** là chủ thể thứ ba của `createSupportRequest` bên cạnh đơn và tài khoản. Giới hạn 3 yêu cầu mở tính theo email (khóa `pg_advisory_xact_lock` theo email). Tin đầu ghi `author = customer` (lời khách gõ), yêu cầu ghi `created_by = chatbot`.
- **Khách đã đăng nhập** nhận ra bằng `optionalAuth` (khung chat gọi qua `optionalAuthFetch`): yêu cầu gắn tài khoản, không hỏi tên và email, response có `link` tới trang tài khoản.
- **Giới hạn 3 lần mỗi IP mỗi ngày** đếm sau khi kiểm dữ liệu, để khách quên điền tên không mất lượt. Cửa sổ 24 giờ làm "cửa sổ dài nhất" của job dọn bộ đếm thành 24 giờ (trước là 1 giờ): dòng đếm được giữ lâu hơn, không đổi hành vi chặn; sửa mốc trong `cleanup.test.ts`.
- **Mỗi cuộc chuyển một lần:** điều kiện `support_request_id IS NULL` nằm trong câu UPDATE trong cùng transaction với việc tạo yêu cầu; hai lần bấm cùng lúc thì lần sau rollback, 409.
- **Tiêu đề:** tóm tắt `handoff` gần nhất của chatbot, cắt 120 ký tự; không có thì câu mặc định. Tin đầu là lời nhắn của khách, trống thì câu mặc định "Khách chuyển từ trợ lý tư vấn…".
- **Khách đòi gặp nhân viên mà model không gọi `handoff`** (chạy thử: 1/3 lần khi đang xem sản phẩm): API tự đề nghị chuyển khi tin của khách nhắc tới nhân viên hay người thật (`chat/intent.ts`, có dấu, không dấu, tiếng Anh), lấy câu của khách làm tiêu đề. Bắt nhầm chỉ làm nút nổi bật. Prompt cũng ghi "bắt buộc gọi handoff" nhưng không đủ tin cậy.
- **Bản chép** đọc từ `chat_message` qua route chi tiết yêu cầu của nhân viên (`chatTranscript`). Route này mở cho `support.handle` và `order.view`, nên kho và kế toán cũng đọc được bản chép, như họ đọc được tin trong yêu cầu.
- **Trang `/yeu-cau/[code]`** của M6b dùng chung: có `don` thì mở theo đơn như cũ; chỉ có `token` thì mở theo token của yêu cầu, không có link "Về đơn hàng".
- **Khung chat:** nút "Gặp nhân viên" mở form (tên, email khi chưa đăng nhập; lời nhắn), gửi xong hiện mã yêu cầu, câu thời gian phản hồi và link (đã đăng nhập) hay câu "sẽ nhận email". "Bắt đầu lại" xóa trạng thái đã gửi.
- **Chạy trên stack local** (Playwright, điện thoại 390px): khách vãng lai hỏi ở trang Coach Tabby → bấm "Gặp nhân viên" → gửi tên, email, lời nhắn → khung chat báo "Đã gửi yêu cầu #YC1001"; link trong email (log API) mở được trang yêu cầu; owner thấy yêu cầu "chuyển từ chatbot" kèm khối "Cuộc trò chuyện với chatbot". Lần chạy đó model không gọi `handoff`, từ đó có `asksForStaff`.
- Bản chép ở trang quản trị hiện chữ thô (markdown chưa render), như tin trong yêu cầu.

## Comments

- Ghi chú từ ticket 04: trang `web/app/pages/yeu-cau/[code].vue` đã có từ M6b, mở yêu cầu bằng `?don=<mã đơn>&token=<token tra cứu đơn>`. Link cho khách vãng lai không có đơn phải dùng chung trang này với một kiểu token khác, không tạo trang mới trùng đường dẫn.
