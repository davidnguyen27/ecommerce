# 07: Báo cáo chatbot

**What to build:** Trang Báo cáo của M7 có thêm tab Chatbot cho người có `chatbot.manage`: số cuộc trò chuyện, số tin, tỷ lệ chuyển nhân viên, token và lỗi theo model, số lần hết lượt, theo khoảng ngày.

**Blocked by:** 05

**Status:** resolved

- [x] `GET /api/admin/reports/chatbot?from&to`: dùng `period.ts` của M7.
  - số cuộc trò chuyện, số tin của khách, theo ngày và tổng;
  - số cuộc đã chuyển, tỷ lệ chuyển (mẫu số 0 trả `null`);
  - theo model: số lượt gọi, token vào, token ra, số lần 429, số lần lỗi;
  - số lần khách bị báo hết lượt.
- [x] Web: tab Chatbot hiện khi có `chatbot.manage`, kể cả người không có `report.view`.
- [x] Test: không có `chatbot.manage` thì 403; tin lúc 23:30 giờ VN thuộc đúng ngày; tổng token theo model khớp `chat_usage_day`.

Spec: "Báo cáo".

## Quyết định khi triển khai

- **Route riêng trước router M7:** `adminReportRoutes` áp `report.view` cho mọi đường bên dưới, nên `/reports/chatbot` mount bằng `adminChatbotReportRoutes` (quyền `chatbot.manage`) **trước** `/reports` trong `routes/admin.ts`. Kế toán có `report.view` mà không có `chatbot.manage` thì 403 (có test).
- **Trang web riêng `/admin/chatbot/report`**, không phải trang con của `/admin/reports` (trang cha đó đòi `report.view`). Trang Báo cáo có thêm tab "Chatbot" (chỉ hiện khi `canOpen`) dẫn sang trang này, giữ nguyên kỳ đang chọn; trang Chatbot có nút "Báo cáo". Dùng `useReportPeriod` như các báo cáo M7, kể cả nhóm theo ngày hay tháng.
- **Cách tính** (`reports/chatbot.ts`):
  - cuộc trò chuyện theo lúc mở cuộc; cuộc đã chuyển là cuộc mở trong kỳ có `support_request_id`; tỷ lệ chuyển mẫu số 0 thì `null`;
  - câu hỏi (tin của khách), hết lượt và lỗi theo lúc gửi;
  - số theo model cộng `chat_usage_day` theo ngày (đã là ngày giờ VN), model nhiều lượt gọi trước.
- Cuộc trò chuyện bị xóa sau 90 ngày (trừ cuộc đã chuyển), nên kỳ cũ hơn thiếu số cuộc và số tin; số theo model vẫn đủ. Trang ghi chú điều này.
- Không có xuất Excel: ticket không yêu cầu.
- **Đã chạy trên stack local** (Playwright): trang Báo cáo → tab Chatbot → `/admin/chatbot/report` hiện tổng, bảng theo ngày, bảng theo model; không có lỗi JavaScript.
- **Số thật trên máy local** (dữ liệu demo, các lần chạy thử từ ticket 03): 51 câu hỏi, 119 lượt gọi, khoảng 129.000 token vào, tức khoảng **2.500 token mỗi câu**, cao hơn nhiều so với mục tiêu khoảng 1.000 của ADR 0017. Với 200.000 token mỗi ngày cho mỗi model Groq, sức chứa thực tế chỉ khoảng 150 câu mỗi ngày cho cả hai model (tính cả token ra, khoảng 2.670 token mỗi câu), chưa tính OpenRouter. Cần thu gọn prompt và kết quả công cụ thêm trước khi mở bán.
