# Chatbot dùng model miễn phí qua một chuỗi dự phòng

Chatbot M8 gọi model qua gói miễn phí, không dùng API trả phí. Người dùng chốt điều này ngày 2026-11-20, thay cho đề xuất ban đầu là Claude API. Mỗi lượt gọi đi lần lượt qua một chuỗi ba model, và chuyển ngay sang model sau khi model trước trả 429 hay lỗi:

1. Groq `openai/gpt-oss-120b` (nguồn chính);
2. Groq `qwen/qwen3.8-27b`, dùng chung khóa nhưng hạn mức tính riêng;
3. OpenRouter `nvidia/nemotron-3-ultra-550b-a55b:free`.

Cả ba đều nói chuẩn chat completions kiểu OpenAI có `tools`, nên chỉ cần một adapter (`api/src/adapters/llm.ts`, gọi bằng `fetch`). Thứ tự, nhà cung cấp và model đặt bằng biến môi trường.

## Bản thử 2026-11-20

Script dùng một lần, chạy chín tình huống tiếng Việt và tiếng Anh: tìm túi theo ngân sách, gợi ý size theo sản phẩm đang xem, hỏi chính sách đổi trả, hỏi đợt đặt trước, hỏi đơn, mô tả sản phẩm có chèn lệnh kèm đòi mã giảm giá, nghi hàng giả và đòi gặp người, câu tiếng Anh, câu ngoài lề. Danh mục là dữ liệu giả, năm công cụ như spec. Khóa của cả hai nơi tự đăng ký được ngay, không cần thẻ.

| Model | Kết quả | Tốc độ | Hạn mức |
|---|---|---|---|
| Groq `gpt-oss-120b` | Đúng 9/9 | 0,5–1 giây mỗi lượt gọi | 1.000 lượt/ngày, 8.000 token/phút, 200.000 token/ngày |
| Groq `qwen3.8-27b` | Đúng 4/4 tình huống chạy hết; một lần gọi tìm kiếm không truyền tham số | Như trên | 7.000 token vào/phút, 200.000 token/ngày |
| OpenRouter `nemotron-3-ultra:free` | Đúng 9/9 | 2–14 giây mỗi tin | 50 lượt/ngày (1.000 sau khi đã nạp tổng $10) |
| OpenRouter `gemma-4-31b:free` | 429 cả 9 lần | Không đo được | Hạn mức chung phía Google đã cạn |

Cả ba model chạy được đều:
- gọi đúng công cụ;
- không đọc đơn;
- bỏ qua câu chèn lệnh trong mô tả sản phẩm;
- không cho mã giảm giá;
- gọi chuyển nhân viên khi khách nghi hàng giả.

Các lỗi gặp được đều sửa bằng prompt:
- khách viết tiếng Anh nhưng model trả lời tiếng Việt;
- model tìm bằng từ khóa tiếng Anh trong khi danh mục ghi tiếng Việt;
- câu chuyển nhân viên nói "đã gửi" trước khi khách xác nhận;
- một lần tự thêm điều khoản trả phần còn lại mà không đọc chính sách đặt trước.

## Considered Options

- **Claude API:** chất lượng và độ ổn định tốt nhất, nhưng tốn tiền. Người dùng không chọn.
- **Gemini gói miễn phí:** tiếng Việt tốt, nhưng Google dùng dữ liệu của gói này để cải thiện sản phẩm và khuyên không gửi thông tin cá nhân. Hạn mức cũng không công bố cố định.
- **Cloudflare Workers AI:** 10.000 neuron/ngày, chỉ đủ khoảng 49.000 token đầu ra mỗi ngày với model 70B.
- **Chỉ dùng Groq `gpt-oss-120b`:** nhanh và đúng, nhưng 8.000 token/phút chỉ đủ khoảng 5 tin mỗi phút cho cả cửa hàng.

## Consequences

- **Giới hạn thật là token, không phải số lượt.**
  - Đo được mỗi tin của khách tốn khoảng 1.600 token cộng dồn qua các lượt gọi. Riêng system prompt và mô tả công cụ đã khoảng 650 token mỗi lượt.
  - Prompt và kết quả công cụ được thu gọn (mô tả sản phẩm cắt ngắn, tối đa 5 sản phẩm, gửi 10 tin gần nhất), nhắm khoảng 1.000 token mỗi tin.
  - Với mức đó, sức chứa khoảng 200 tin mỗi ngày cho mỗi model Groq, cộng khoảng 20 tin qua OpenRouter: khoảng 420 tin mỗi ngày.
  - **Đo thật (2026-11-21, `pnpm chatbot-check --api`, 9 tình huống trên dữ liệu demo):** bản đầu tốn khoảng 2.800 token vào mỗi câu, 2,4 lượt gọi. Phần cố định mỗi lượt gọi là khoảng 710 token với gpt-oss và khoảng 1.000 với qwen (qwen dàn schema công cụ rất dài). Sau khi thu gọn còn khoảng 1.300 token vào mỗi câu, 1,7 lượt gọi, tức khoảng 280 câu mỗi ngày cho hai model Groq:
    - system prompt, mô tả công cụ viết tiếng Anh, gọn; câu khách đọc nguyên văn giữ tiếng Việt;
    - bỏ công cụ liệt kê chính sách: prompt mang slug các trang chính sách;
    - `get_product` nhận tên khi chưa biết slug, bớt một lượt tìm;
    - biến thể viết một dòng, bỏ URL trong kết quả công cụ, cắt câu trả lời cũ trong lịch sử;
    - lời nhắc ngôn ngữ chọn theo tin của khách (`looksEnglish`), vì qwen vẫn trả lời tiếng Việt cho tin tiếng Anh khi chỉ có lời nhắc chung.
- **Không có trần chi tiêu do mình tự đặt.** Gói miễn phí không phát sinh tiền, và nhà cung cấp tự chặn bằng 429.
  - Model trả 429 thì API ghi nhớ model đó đang hết tới lúc `retry-after`, rồi bỏ qua nó thay vì gọi lại liên tục.
  - Cả ba cùng hết thì chatbot báo đã hết lượt hôm nay, kèm nút gửi yêu cầu cho nhân viên.
  - Token dùng mỗi ngày được ghi lại, để biết lúc nào cần đổi sang gói trả phí.
- **Không có SLA.**
  - Theo các nguồn thứ ba, Groq đổi danh sách model miễn phí mà không báo trước. OpenRouter phụ thuộc hạn mức chung của nhà cung cấp gốc.
  - Đổi model chỉ cần sửa biến môi trường, nhưng model mới phải chạy lại bộ tình huống của bản thử trước khi dùng.
- **Dữ liệu khách đi qua bên thứ ba.**
  - OpenRouter chỉ chạy model miễn phí khi tài khoản cho phép nhà cung cấp lưu hoặc dùng prompt.
  - Vì vậy khung chat báo khách rằng cuộc trò chuyện được xử lý bởi nhà cung cấp AI bên ngoài, và chính sách bảo mật thêm một đoạn về chatbot.
  - Chatbot không bao giờ gửi thông tin đơn hay thông tin cá nhân lấy từ hệ thống cho model.
- **Nâng cấp sau này:**
  - Nạp $10 cho OpenRouter thì model cuối của chuỗi có 1.000 lượt/ngày.
  - Gói Dev của Groq nâng hạn mức token.
  - Chuyển sang API trả phí (kể cả Claude) chỉ cần một adapter khác sau cùng interface.
- **Khóa:** `GROQ_API_KEY` và `OPENROUTER_API_KEY` chỉ nằm trong `.env` và biến môi trường của Render. Hook trước commit chặn nếu chúng lọt vào commit. Thiếu khóa thì chatbot tự tắt.
