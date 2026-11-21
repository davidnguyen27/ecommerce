# 06: Trang quản trị chatbot

**What to build:** Owner có trang Chatbot trong quản trị: bật/tắt, soạn câu thời gian phản hồi, xem danh sách cuộc trò chuyện và đọc từng cuộc.

**Blocked by:** 05

**Status:** resolved

- [x] `GET /api/admin/chatbot/conversations`: lọc theo khoảng ngày (giờ VN), đã chuyển hay chưa, có lỗi hay không; phân trang.
- [x] `GET /api/admin/chatbot/conversations/:id`: các tin, thẻ sản phẩm, model trả lời, lỗi, link tới yêu cầu đã chuyển.
- [x] Web: menu Chatbot chỉ hiện khi có `chatbot.manage`; tab Cài đặt (công tắc, câu thời gian phản hồi, trạng thái từng model: có khóa, đang hết tới lúc nào) và tab Cuộc trò chuyện.
- [x] Test: không có `chatbot.manage` thì 403; lọc đúng; chi tiết không lộ IP gốc.

Spec: "API" (quản trị), "Web" (quản trị).

## Quyết định khi triển khai

- **API** (`routes/admin-chatbot.ts`, quyền `chatbot.manage`):
  - `GET /api/admin/chatbot/status`: `configured` (máy chủ có khóa model nào không) và từng model của chuỗi kèm `exhaustedUntil`. Trạng thái nằm trong bộ nhớ của process API trả lời request (ADR 0017); nhiều instance thì mỗi instance một trạng thái. `adminRoutes` nhận thêm `llm`.
  - `GET /api/admin/chatbot/conversations`: lọc `from`, `to` (ngày giờ VN, theo tin cuối), `handedOff` (`true`/`false`), `failed` (`true`: có tin của khách mang lỗi); mới nhất trước; 50 mỗi trang. Mỗi dòng có câu hỏi đầu (cắt 120 ký tự), số câu, số lượt không trả lời được, mã yêu cầu.
  - `GET /api/admin/chatbot/conversations/:id`: các tin kèm `model`, `promptVersion`, `error`, `handoffSummary`, sản phẩm đã gợi ý; không trả `ip_hash`.
- **Web:** mục menu "Chatbot" trong nhóm Bán hàng (`chatbot.manage`); trang `/admin/chatbot` (cài đặt và bảng model), `/admin/chatbot/conversations` (đăng ký trong `ADMIN_SUBPAGES`), `/admin/chatbot/conversations/[id]`. Dùng trang riêng nối bằng nút thay cho tab, theo cách các trang quản trị khác.
- Thẻ sản phẩm đầy đủ không lưu (ticket 03), nên chi tiết chỉ hiện tên sản phẩm đã gợi ý kèm link.
- **Đã chạy trên stack local** (Playwright, owner demo): menu Chatbot → trang cài đặt hiện ba model "Dùng được" → danh sách 50 cuộc, lọc "Đã chuyển" còn 1 → chi tiết có model `groq:qwen/qwen3.8-27b`, prompt v1, link #YC1001; không có lỗi JavaScript.
