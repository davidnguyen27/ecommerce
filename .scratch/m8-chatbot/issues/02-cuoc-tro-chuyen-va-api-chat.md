# 02: Cuộc trò chuyện và API chat

**What to build:** Khách gửi tin và nhận câu trả lời stream qua API, chưa có công cụ. Tin được lưu theo cuộc trò chuyện, có giới hạn tần suất, có công tắc bật/tắt của owner và ghi token mỗi ngày. Cuộc trò chuyện cũ bị xóa sau 90 ngày.

**Blocked by:** 01

**Status:** resolved

- [x] Migration:
  - `chat_conversation`, `chat_message`, `chat_usage_day` (ngày × model; thêm số lần hết lượt của cả ngày);
  - dòng cài đặt chatbot: bật/tắt (mặc định tắt), câu thời gian phản hồi.
- [x] Quyền mới `chatbot.manage`, chỉ owner. `GET/PUT /api/admin/chatbot/settings` ghi qua `audited()`; không đổi gì thì không audit.
- [x] `GET /api/chat/status`: trả lời được hay không (tắt, không có model, hết lượt), câu quyền riêng tư.
- [x] `POST /api/chat/messages` (SSE): mã cuộc trò chuyện (có thể trống), nội dung 1–500 ký tự, slug sản phẩm đang xem.
  - không có mã hay cuộc đã im quá 24 giờ thì mở cuộc mới, trả mã;
  - gửi system prompt và 10 tin gần nhất; stream chữ; lưu tin khách và tin trả lời cùng model;
  - ghi lượt gọi và token vào `chat_usage_day`;
  - lỗi hay hết lượt: lưu tin khách cùng lỗi, gửi sự kiện trạng thái để khung chat hiện nút gửi yêu cầu.
- [x] `GET /api/chat/conversations/:id`: các tin để hiện lại.
- [x] `RATE_LIMITS`: 30 tin của khách mỗi cuộc, 60 tin mỗi giờ mỗi IP.
- [x] Job xóa cuộc trò chuyện có tin cuối quá 90 ngày. Phần "trừ cuộc đã gắn yêu cầu hỗ trợ" chuyển sang ticket 05, khi mới có liên kết.
- [x] System prompt đặt trong code, có số phiên bản, theo các ý của spec mục "Vòng lặp gọi công cụ".
- [x] Test:
  - tắt, không có khóa, hết lượt thì không gọi model;
  - tin 501 ký tự là 400; tin thứ 31 mỗi cuộc và tin thứ 61 mỗi IP mỗi giờ là 429;
  - im 24 giờ thì mở cuộc mới; model chỉ nhận 10 tin gần nhất;
  - lượt lỗi vẫn lưu tin khách; token ghi đúng model;
  - không có `chatbot.manage` thì 403 ở cài đặt; đổi cài đặt có audit;
  - job xóa đúng cuộc quá hạn (giữ cuộc đã gắn yêu cầu: ticket 05).

Spec: "Vòng lặp gọi công cụ", "Mô hình", "Giới hạn và khi lỗi", "API".

## Quyết định khi triển khai

- **JSON thay cho SSE.** `POST /api/chat/messages` trả `{ conversationId, outcome, reply }` một lần. Lý do: adapter không stream (ticket 01), và API nằm sau proxy Netlify (ADR 0011), có thể giữ SSE lại tới khi xong. Khung chat (ticket 04) hiện "đang trả lời…" trong lúc chờ. Thẻ sản phẩm (ticket 03) sẽ thêm vào cùng body.
- **`outcome`:** `answered`; `exhausted`/`failed` (tin của khách đã lưu, mang `error`, không có trả lời); `disabled`/`unconfigured` (không lưu gì, `conversationId: null`). HTTP luôn 200, trừ lỗi nhập (400) và giới hạn (429).
- **Giới hạn 30 tin mỗi cuộc** đếm bằng cột `customer_message_count`, khóa dòng cuộc khi ghi, không dùng `RATE_LIMITS`. Đủ 30 thì 429 kèm câu bảo bấm "Bắt đầu lại", và `GET` cuộc đó trả `active: false`. Giới hạn 60 tin mỗi giờ mỗi IP dùng `RATE_LIMITS.chatMessagePerIp`, áp cả khi chatbot tắt.
- **Hết lượt không có cột riêng.** Số lần khách bị báo hết lượt đếm từ `chat_message.error = 'exhausted'`. `chat_usage_day` chỉ giữ số theo model: lượt gọi thật (không tính model bị bỏ qua), token của model đã trả lời, số 429, số lỗi khác. Để có số 429 của model trước model trả lời, `LlmResult` có thêm `attempts` (sửa adapter của ticket 01).
- **Gọi model ngoài transaction.** Tin của khách được ghi trước trong transaction một; câu trả lời và lượt gọi ghi trong transaction hai.
- **Mã cuộc trò chuyện là uuid bí mật.** Ai có mã thì đọc được cuộc. Không lưu tài khoản khách ở ticket này: ticket 05 gắn tài khoản lúc chuyển nhân viên. `ip_hash` là SHA-256 của IP.
- **Lời nhắc ngôn ngữ** (`LANGUAGE_REMINDER`) là system message đặt sau tin của khách. Không tự đoán ngôn ngữ, vì khách Việt hay gõ không dấu.
- **System prompt** ở `api/src/chat/prompt.ts`, `PROMPT_VERSION = 1`, ghi vào từng tin của chatbot. Prompt đã nhắc tới công cụ của ticket 03; trong lúc chưa có công cụ, chatbot vẫn đang tắt mặc định.
- `scripts/chatbot-check.ts` dùng `promptMessages` của API, nên kiểm đúng prompt đang chạy.
- **Cài đặt:** `GET/PUT /api/admin/chatbot/settings` (thay cả hai trường), khóa `pg_advisory_xact_lock`, audit `chatbot.settings.update`. Trang quản trị làm ở ticket 06.
- **Job xóa** nằm trong `deleteExpiredRecords` (chạy 3 giờ sáng), xóa cuộc có tin cuối quá 90 ngày; tin xóa theo (`ON DELETE CASCADE`). Ticket 05 thêm điều kiện giữ cuộc đã gắn yêu cầu.
- Migration viết tay; đã so với schema bằng `prisma migrate diff` trên Postgres tạm, không lệch ở các bảng chat.

### `pnpm chatbot-check` với prompt chính thức (2026-11-21)

- Câu tiếng Anh được trả lời bằng tiếng Anh; `gpt-oss` không còn viết lẫn.
- Còn hai điểm để ticket 03 kiểm lại với công cụ thật: `qwen` vẫn nói "đã chuyển" trước khi khách xác nhận; câu hỏi đặt trước chỉ đọc chính sách, không mở chi tiết sản phẩm.
