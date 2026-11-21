# 04: Khung chat trên web khách

**What to build:** Nút chat nổi ở mọi trang web khách, trừ trang đặt mua và thanh toán. Mở ra là khung chat có dòng quyền riêng tư, chữ hiện dần theo stream, thẻ sản phẩm, nút "Gặp nhân viên". Chatbot không trả lời được thì khung chat nói rõ và vẫn cho gửi yêu cầu. Lỗi của khung chat không ảnh hưởng trang.

**Blocked by:** 03

**Status:** resolved

- [x] Component tải sau trang (lazy); không có trên trang đặt mua và thanh toán.
- [x] Điện thoại: toàn màn hình; máy tính: khung ở góc dưới.
- [x] Dòng quyền riêng tư kèm link chính sách bảo mật.
- [x] Mã cuộc trò chuyện giữ trong `localStorage` (bọc try/catch); tải lại các tin khi mở; nút "Bắt đầu lại".
- [x] Trang sản phẩm gửi slug đang xem cùng mỗi tin.
- [x] Thẻ sản phẩm có ảnh, tên, giá, tình trạng, link. (Không stream chữ: API trả JSON từ ticket 02; hiện "Đang trả lời…".)
- [x] Trạng thái tắt / hết lượt / lỗi: thông báo tương ứng kèm nút gửi yêu cầu và link trang chính sách.
- [x] Nút "Gặp nhân viên" luôn hiện; khi có sự kiện "đề nghị chuyển" thì nút nổi bật. Form chuyển làm ở ticket 05; ticket này chỉ mở được form rỗng hoặc dẫn tới trang liên hệ.
- [x] Soạn nháp đoạn về chatbot cho chính sách bảo mật, ghi vào mục Comments của ticket để chủ doanh nghiệp duyệt.
- [ ] Test component (vitest): không làm được, vitest của web chỉ chạy logic thuần, không dựng Nuxt. Thay bằng test logic thuần (`web/test/chat.test.ts`), chạy tay trên stack local bằng Playwright (bên dưới), và E2E ở ticket 08.

Spec: "Web".

## Quyết định khi triển khai

- **Gắn vào layout khách** (`layouts/default.vue`) trong `<ClientOnly>` dưới dạng `LazyChatWidget`: HTML server render không đổi (smoke không cần sửa), component tải sau trang và lỗi của nó không chặn trang. Ẩn ở `/dat-mua`, `/dat-truoc/*`, `/thanh-toan-gia-lap` và `/admin` (`chatHiddenOn`).
- **Không stream** (ticket 02 trả JSON): tin của khách hiện ngay, kèm dòng "Đang trả lời…" cho tới khi có câu trả lời.
- **Câu trả lời render markdown** bằng `renderMarkdown` (đã thoát HTML và chặn link `javascript:`), vì model trả về chữ đậm, danh sách, link `/trang/...`.
- **Thẻ sản phẩm** (ảnh, thương hiệu, tên, "Từ" giá, tình trạng) chỉ có ở lượt vừa trả lời. Mở lại cuộc thì tin đó hiện link theo tên (`products` đã lưu), không gọi lại API để lấy giá.
- **Cuộc mới khi cuộc cũ đã hết hạn:** API trả mã khác thì khung chat bỏ các tin cũ trên màn hình, chỉ giữ câu vừa hỏi.
- **Lỗi 429 hay mất mạng:** bỏ tin vừa hiện, trả câu hỏi về ô nhập và hiện thông báo lỗi của API. Tắt, hết lượt, lỗi model: tin của khách mang dòng "Chưa có trả lời", phía dưới có câu theo lý do (`unavailableText`).
- **Nút "Gặp nhân viên"** luôn hiện, nổi bật khi chatbot đề nghị chuyển hay không trả lời được. Ở ticket này nút mở một đoạn chỉ tới trang tài khoản và link tra cứu đơn; ticket 05 thay bằng form.
- Điện thoại: khung chiếm cả màn hình, chuyển trang thì đóng. Máy tính: khung 384px ở góc phải dưới, chuyển trang vẫn mở. Esc đóng khung.
- Test: `web/test/chat.test.ts` cho logic thuần (lưu mã, trang ẩn, slug đang xem, câu theo lý do). Web không có test component; giao diện do E2E ticket 08 phủ.
- **Đã chạy trên stack local** bằng Playwright (Edge), máy tính 1280px và điện thoại 390px:
  - ở trang Air Max 90, hỏi "cái này màu đen size 41 còn không?" thì chatbot trả lời đúng theo sản phẩm đang xem;
  - hỏi túi dưới 15 triệu thì có hai thẻ (Michael Kors, Coach) kèm giá và tình trạng;
  - tải lại trang thì cuộc còn nguyên, thẻ thành link;
  - owner tắt chatbot thì khung báo "Trợ lý đang tạm nghỉ" và nút "Gặp nhân viên" nổi bật;
  - `/dat-mua` không có nút chat; không có lỗi JavaScript.

## Comments

**Nháp đoạn về chatbot cho chính sách bảo mật** (chờ chủ doanh nghiệp duyệt rồi xuất bản trong trang "Chính sách bảo mật"):

> **Trợ lý tư vấn (chatbot)**
>
> Website có trợ lý tư vấn tự động giúp bạn tìm sản phẩm và đọc chính sách. Khi bạn trò chuyện với trợ lý:
>
> - Nội dung bạn gõ được gửi tới nhà cung cấp trí tuệ nhân tạo bên ngoài (hiện là Groq và OpenRouter) để tạo câu trả lời. Các nhà cung cấp này có thể lưu nội dung theo chính sách của họ. Vì vậy, xin đừng nhập số điện thoại, địa chỉ, số tài khoản hay thông tin nhạy cảm khác vào khung chat.
> - Cửa hàng lưu cuộc trò chuyện trong 90 ngày để kiểm tra chất lượng tư vấn, rồi xóa. Cuộc trò chuyện bạn chọn chuyển cho nhân viên được giữ cùng yêu cầu hỗ trợ.
> - Trợ lý không xem được đơn hàng hay thông tin tài khoản của bạn, và không tự thay đổi đơn, giá hay mã giảm giá.
> - Câu trả lời của trợ lý chỉ để tham khảo; giá, tình trạng hàng và chính sách chính thức là nội dung hiện trên trang sản phẩm và trang chính sách.
