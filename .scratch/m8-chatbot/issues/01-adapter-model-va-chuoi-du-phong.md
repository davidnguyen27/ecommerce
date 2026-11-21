# 01: Adapter model và chuỗi dự phòng

**What to build:** Một module gọi model qua chuẩn chat completions kiểu OpenAI, đi lần lượt qua chuỗi model trong `LLM_CHAIN` và chuyển model khi gặp 429, 5xx hay quá thời gian chờ. Kèm một adapter giả cho test và một script thủ công chạy chín tình huống của bản thử trên chuỗi thật. Chưa có route hay bảng nào; ticket sau dùng module này.

**Blocked by:** —

**Status:** resolved

- [x] `api/src/adapters/llm.ts`:
  - nhận `messages`, `tools`, có/không cho gọi công cụ; trả nội dung, lời gọi công cụ, `usage` và model đã trả lời;
  - gọi bằng `fetch`, không thêm SDK.
- [x] `LLM_CHAIN` mặc định `groq:openai/gpt-oss-120b,groq:qwen/qwen3.8-27b,openrouter:nvidia/nemotron-3-ultra-550b-a55b:free`; khóa lấy từ `GROQ_API_KEY`, `OPENROUTER_API_KEY`.
  - `gpt-oss` gửi kèm `reasoning_effort: low`.
  - Thiếu khóa của một nhà cung cấp thì bỏ các model của nhà cung cấp đó; không còn model nào thì báo chatbot không dùng được.
- [x] Chuyển model:
  - 429, 5xx, quá thời gian chờ (20 giây Groq, 30 giây OpenRouter) thì gọi ngay model kế tiếp;
  - model trả 429 bị đánh dấu đang hết tới `retry-after` (thiếu header thì 60 giây), giữ trong bộ nhớ process;
  - cả chuỗi hỏng thì báo lỗi phân biệt được "hết lượt" (mọi model đang hết) với "lỗi".
- [x] Adapter giả theo kịch bản, chọn bằng biến môi trường cho test và E2E.
- [x] Script `scripts/chatbot-check.ts`: chín tình huống của bản thử (ADR 0017), in công cụ đã gọi, thời gian và câu trả lời. Không chạy trong CI.
- [x] `.env.example` có `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `LLM_CHAIN` (comment giải thích).
- [x] Test (adapter giả hoặc `fetch` giả):
  - model đầu 429 thì model hai trả lời, kết quả ghi đúng model;
  - model đã 429 bị bỏ qua tới hết `retry-after`, sau đó được gọi lại;
  - thiếu khóa OpenRouter thì chuỗi chỉ còn hai model Groq;
  - cả chuỗi hết thì ra "hết lượt", cả chuỗi 5xx thì ra "lỗi".

Spec: "Nguồn model (ADR 0017)".

## Quyết định khi triển khai

- **Không stream ở adapter.** `complete()` trả cả câu một lần. Lý do: khi đổi model giữa chừng, một luồng đã stream nửa chừng không ghép tiếp được; Groq trả lời trong 0,5–2 giây nên chờ cả câu vẫn nhanh. Ticket 02 quyết định có stream hay gửi cả câu qua một sự kiện SSE.
- **Lỗi khác 429 cũng chuyển model**, gồm 4xx khác (ví dụ model bị gỡ khỏi gói miễn phí), lỗi mạng, JSON hỏng, trả lời rỗng. Chỉ 429 làm model bị đánh dấu đang hết.
- `LlmUnavailableError.reason`: `exhausted` khi không model nào lỗi khác 429 (tất cả 429 hay đang bị bỏ qua); `failed` khi có ít nhất một lỗi khác. `attempts` ghi từng model để ticket 02 cộng vào `chat_usage_day`.
- `max_tokens` 1024 cho mỗi lần gọi.
- `LLM_CHAIN=fake` dùng `ScriptedLlm`: không có kịch bản thì nhắc lại tin cuối của khách. Test API (ticket 02) truyền `ScriptedLlm` có kịch bản qua `AppDeps`.
- `llm.ts` không dùng parameter properties để `scripts/chatbot-check.ts` import được khi chạy thẳng bằng `node` (type stripping).
- Script chạy bằng `pnpm chatbot-check` (`node --env-file=.env`). Danh mục, chính sách và công cụ trong script là bản giả; ticket 03 nối vào công cụ thật.
- Test chạy trên máy với config không có global setup (Docker chưa chạy); CI chạy như mọi test khác.

### Lần chạy `pnpm chatbot-check` ngày 2026-11-21

- Lần một với prompt nháp có câu "không có căn cứ thì gọi handoff": model chuyển nhân viên cả khi hỏi chính sách và hỏi đơn, và tự đoán slug sản phẩm.
- Đã sửa prompt nháp: tìm trước rồi mới lấy chi tiết; câu về chính sách thì đọc trang chính sách; hỏi đơn thì không chuyển; chỉ chuyển khi khách đòi, khiếu nại, cần xác minh hay công cụ không có thông tin.
- Lần hai đạt 8/9. Chuỗi chuyển model đúng khi gặp 429: một lượt đi qua cả ba model.
- **Còn lỗi:** khách viết tiếng Anh thì `qwen` và Nemotron vẫn trả lời tiếng Việt. Câu nhắc tiếng Anh trong prompt còn làm `gpt-oss` viết lẫn ("If you cần hỗ trợ thêm"). Đề xuất cho ticket 02: API tự nhận ra tin không có dấu tiếng Việt và chèn một system message ngắn ngay sau tin của khách, bảo trả lời bằng tiếng Anh; bỏ câu tiếng Anh khỏi system prompt.
