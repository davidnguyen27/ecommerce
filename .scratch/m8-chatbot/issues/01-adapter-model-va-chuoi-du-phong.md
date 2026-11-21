# 01: Adapter model và chuỗi dự phòng

**What to build:** Một module gọi model qua chuẩn chat completions kiểu OpenAI, đi lần lượt qua chuỗi model trong `LLM_CHAIN` và chuyển model khi gặp 429, 5xx hay quá thời gian chờ. Kèm một adapter giả cho test và một script thủ công chạy chín tình huống của bản thử trên chuỗi thật. Chưa có route hay bảng nào; ticket sau dùng module này.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] `api/src/adapters/llm.ts`:
  - nhận `messages`, `tools`, có/không cho gọi công cụ; trả nội dung, lời gọi công cụ, `usage` và model đã trả lời;
  - gọi bằng `fetch`, không thêm SDK.
- [ ] `LLM_CHAIN` mặc định `groq:openai/gpt-oss-120b,groq:qwen/qwen3.8-27b,openrouter:nvidia/nemotron-3-ultra-550b-a55b:free`; khóa lấy từ `GROQ_API_KEY`, `OPENROUTER_API_KEY`.
  - `gpt-oss` gửi kèm `reasoning_effort: low`.
  - Thiếu khóa của một nhà cung cấp thì bỏ các model của nhà cung cấp đó; không còn model nào thì báo chatbot không dùng được.
- [ ] Chuyển model:
  - 429, 5xx, quá thời gian chờ (20 giây Groq, 30 giây OpenRouter) thì gọi ngay model kế tiếp;
  - model trả 429 bị đánh dấu đang hết tới `retry-after` (thiếu header thì 60 giây), giữ trong bộ nhớ process;
  - cả chuỗi hỏng thì báo lỗi phân biệt được "hết lượt" (mọi model đang hết) với "lỗi".
- [ ] Adapter giả theo kịch bản, chọn bằng biến môi trường cho test và E2E.
- [ ] Script `scripts/chatbot-check.ts`: chín tình huống của bản thử (ADR 0017), in công cụ đã gọi, thời gian và câu trả lời. Không chạy trong CI.
- [ ] `.env.example` có `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `LLM_CHAIN` (comment giải thích).
- [ ] Test (adapter giả hoặc `fetch` giả):
  - model đầu 429 thì model hai trả lời, kết quả ghi đúng model;
  - model đã 429 bị bỏ qua tới hết `retry-after`, sau đó được gọi lại;
  - thiếu khóa OpenRouter thì chuỗi chỉ còn hai model Groq;
  - cả chuỗi hết thì ra "hết lượt", cả chuỗi 5xx thì ra "lỗi".

Spec: "Nguồn model (ADR 0017)".
