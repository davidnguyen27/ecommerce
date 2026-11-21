# 06: Trang quản trị chatbot

**What to build:** Owner có trang Chatbot trong quản trị: bật/tắt, soạn câu thời gian phản hồi, xem danh sách cuộc trò chuyện và đọc từng cuộc.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] `GET /api/admin/chatbot/conversations`: lọc theo khoảng ngày (giờ VN), đã chuyển hay chưa, có lỗi hay không; phân trang.
- [ ] `GET /api/admin/chatbot/conversations/:id`: các tin, thẻ sản phẩm, model trả lời, lỗi, link tới yêu cầu đã chuyển.
- [ ] Web: menu Chatbot chỉ hiện khi có `chatbot.manage`; tab Cài đặt (công tắc, câu thời gian phản hồi, trạng thái từng model: có khóa, đang hết tới lúc nào) và tab Cuộc trò chuyện.
- [ ] Test: không có `chatbot.manage` thì 403; lọc đúng; chi tiết không lộ IP gốc.

Spec: "API" (quản trị), "Web" (quản trị).
