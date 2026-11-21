# 02: Cuộc trò chuyện và API chat

**What to build:** Khách gửi tin và nhận câu trả lời stream qua API, chưa có công cụ. Tin được lưu theo cuộc trò chuyện, có giới hạn tần suất, có công tắc bật/tắt của owner và ghi token mỗi ngày. Cuộc trò chuyện cũ bị xóa sau 90 ngày.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Migration:
  - `chat_conversation`, `chat_message`, `chat_usage_day` (ngày × model; thêm số lần hết lượt của cả ngày);
  - dòng cài đặt chatbot: bật/tắt (mặc định tắt), câu thời gian phản hồi.
- [ ] Quyền mới `chatbot.manage`, chỉ owner. `GET/PUT /api/admin/chatbot/settings` ghi qua `audited()`; không đổi gì thì không audit.
- [ ] `GET /api/chat/status`: trả lời được hay không (tắt, không có model, hết lượt), câu quyền riêng tư.
- [ ] `POST /api/chat/messages` (SSE): mã cuộc trò chuyện (có thể trống), nội dung 1–500 ký tự, slug sản phẩm đang xem.
  - không có mã hay cuộc đã im quá 24 giờ thì mở cuộc mới, trả mã;
  - gửi system prompt và 10 tin gần nhất; stream chữ; lưu tin khách và tin trả lời cùng model;
  - ghi lượt gọi và token vào `chat_usage_day`;
  - lỗi hay hết lượt: lưu tin khách cùng lỗi, gửi sự kiện trạng thái để khung chat hiện nút gửi yêu cầu.
- [ ] `GET /api/chat/conversations/:id`: các tin để hiện lại.
- [ ] `RATE_LIMITS`: 30 tin của khách mỗi cuộc, 60 tin mỗi giờ mỗi IP.
- [ ] Job xóa cuộc trò chuyện có tin cuối quá 90 ngày, trừ cuộc đã gắn yêu cầu hỗ trợ.
- [ ] System prompt đặt trong code, có số phiên bản, theo các ý của spec mục "Vòng lặp gọi công cụ".
- [ ] Test:
  - tắt, không có khóa, hết lượt thì không gọi model;
  - tin 501 ký tự là 400; tin thứ 31 mỗi cuộc và tin thứ 61 mỗi IP mỗi giờ là 429;
  - im 24 giờ thì mở cuộc mới; model chỉ nhận 10 tin gần nhất;
  - lượt lỗi vẫn lưu tin khách; token ghi đúng model;
  - không có `chatbot.manage` thì 403 ở cài đặt; đổi cài đặt có audit;
  - job xóa đúng cuộc quá hạn, giữ cuộc đã gắn yêu cầu.

Spec: "Vòng lặp gọi công cụ", "Mô hình", "Giới hạn và khi lỗi", "API".
