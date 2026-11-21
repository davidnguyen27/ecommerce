# 07: Báo cáo chatbot

**What to build:** Trang Báo cáo của M7 có thêm tab Chatbot cho người có `chatbot.manage`: số cuộc trò chuyện, số tin, tỷ lệ chuyển nhân viên, token và lỗi theo model, số lần hết lượt, theo khoảng ngày.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] `GET /api/admin/reports/chatbot?from&to`: dùng `period.ts` của M7.
  - số cuộc trò chuyện, số tin của khách, theo ngày và tổng;
  - số cuộc đã chuyển, tỷ lệ chuyển (mẫu số 0 trả `null`);
  - theo model: số lượt gọi, token vào, token ra, số lần 429, số lần lỗi;
  - số lần khách bị báo hết lượt.
- [ ] Web: tab Chatbot hiện khi có `chatbot.manage`, kể cả người không có `report.view`.
- [ ] Test: không có `chatbot.manage` thì 403; tin lúc 23:30 giờ VN thuộc đúng ngày; tổng token theo model khớp `chat_usage_day`.

Spec: "Báo cáo".
