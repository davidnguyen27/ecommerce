# 03: Công cụ và thẻ sản phẩm

**What to build:** Chatbot tìm được sản phẩm, đọc chi tiết sản phẩm (biến thể, bảng size, đợt đặt trước), đọc chính sách và đề nghị chuyển nhân viên. Mỗi sản phẩm tìm được đi kèm một thẻ sản phẩm dựng từ DB. Sản phẩm khách đang xem được đưa sẵn vào ngữ cảnh.

**Blocked by:** 02

**Status:** resolved

- [x] Vòng lặp gọi công cụ: tối đa 3 vòng, sau đó gọi một lần không kèm công cụ để buộc trả lời.
- [x] `search_products`: dùng lại `searchPage`; tối đa 5 sản phẩm; tên, slug, thương hiệu, khoảng giá, còn/hết/đang nhận đặt trước. Ảnh không gửi cho model.
- [x] `get_product`: mô tả cắt còn khoảng 600 ký tự, thuộc tính, biến thể kèm giá và còn/hết, bảng size, hướng dẫn sử dụng và bảo quản, thông tin nguồn gốc công bố, cam kết có bằng chứng đang hiện công khai, đợt đặt trước đang mở, các trang chính sách liên kết.
- [x] `list_policies`, `get_policy`: chỉ trang đã xuất bản, kèm link.
- [x] `handoff`: chỉ trả tóm tắt; API gửi sự kiện "đề nghị chuyển" về khung chat, không tạo yêu cầu.
- [x] Ngữ cảnh trang: slug sản phẩm đang xem được đọc và đưa sẵn vào ngữ cảnh (dưới dạng kết quả công cụ, xem quyết định bên dưới).
- [x] Thẻ sản phẩm (trong body JSON, ticket 02 bỏ SSE): ảnh, tên, giá, tình trạng, link, lấy từ kết quả công cụ. Lưu slug và tên của thẻ vào `chat_message`.
- [x] Test:
  - công cụ chạy đúng tham số; quá 3 vòng thì buộc trả lời;
  - sản phẩm nháp, ẩn, lưu trữ không xuất hiện; trang chính sách nháp không đọc được;
  - không trả số tồn, giá vốn, chứng từ;
  - model viết giá sai thì thẻ vẫn đúng giá;
  - mô tả sản phẩm chèn lệnh chỉ đi vào kết quả công cụ, không vào system prompt;
  - `handoff` không tạo yêu cầu nào.
- [x] Chạy `scripts/chatbot-check.ts` trên chuỗi thật với dữ liệu seed; ghi kết quả vào mục "Quyết định khi triển khai".

Spec: "Công cụ".

## Quyết định khi triển khai

- **Dùng chung với trang sản phẩm.** Logic của `routes/public-products.ts` tách sang `catalog/public-products.ts` (`searchProductCards`, `findPublicProduct`). Công cụ đọc đúng dữ liệu khách thấy trên web, nên quy tắc snapshot và tồn (ADR 0006, 0007) không phải viết lại. `searchPage` có thêm tham số cỡ trang; thẻ trong chat là `ProductCard` có sẵn.
- **Sản phẩm đang xem là một lần gọi `get_product` dựng sẵn**, đặt sau tin của khách, không vào system message. Ticket ghi hai ý trái nhau ("đưa vào system message" và "mô tả chèn lệnh không vào system prompt"); chọn cách giữ dữ liệu sản phẩm luôn ở vai trò công cụ.
- **Tham số của `search_products`:** `text`, `productType`, `brand` (tên hay slug, không khớp thì gộp vào từ khóa), `color`, `gender`, `minPrice`, `maxPrice`. Chưa lọc theo danh mục và thuộc tính khác.
  - Tìm kiếm của web chỉ khớp tên, thương hiệu, mã; tên sản phẩm phần lớn tiếng Anh, nên "túi đi làm" hay "giày đen" không ra gì (chạy thử trên dữ liệu demo).
  - Vì vậy loại hàng đi qua `productType`, màu qua `color` (thuộc tính `mau`, chỉ khi có nhóm hàng; viết hoa chữ đầu cho khớp "Đen"), giới tính qua `gender`.
  - Từ khóa không khớp mà còn bộ lọc khác thì tìm lại không dùng từ khóa, kèm `note` cho model.
- **Lời nhắc ngôn ngữ luôn đúng một và ở cuối.** Sau mỗi vòng công cụ, lời nhắc cũ được bỏ và đặt lại sau kết quả công cụ. Lý do, từ chạy thử: lời nhắc đứng trước kết quả công cụ tiếng Việt thì tin tiếng Anh vẫn được trả lời tiếng Việt; còn để nhiều lời nhắc xen giữa thì `gpt-oss` viết ra chữ vô nghĩa.
- **Chính sách:** `list_policies`, `get_policy` chỉ đọc trang `policy` đã xuất bản, nội dung cắt 4.000 ký tự, kèm URL `/trang/<slug>`. `get_product` cũng kèm URL cho các trang chính sách; thiếu URL thì model tự bịa link.
- **`handoff`** chỉ trả tóm tắt; tin của chatbot lưu `handoff_summary` (ticket 05 dùng làm tiêu đề), response có `handoffSuggested`. Tin của chatbot lưu thêm `products` (slug, tên) để hiện lại; response có `cards` đầy đủ, chỉ có trong lượt đó.
- **Log:** mỗi lượt trả lời ghi `conversationId`, model và các công cụ đã gọi kèm tham số, không ghi nội dung khách gõ.
- Prompt sửa thêm sau chạy thử: gọi `get_product` trước khi nói về bảo hành, nguồn gốc, size của một sản phẩm; không tìm thấy hàng thì gợi ý nới điều kiện, không chuyển nhân viên; không bao giờ nói "đã chuyển" hay "đã gửi".
- `docker-compose.yml` và `render.yaml` truyền `GROQ_API_KEY`, `OPENROUTER_API_KEY` (compose thêm `LLM_CHAIN`) cho API.
- `pnpm chatbot-check --api <url>` hỏi API thật: bật chatbot của bản đó bằng owner của dữ liệu demo, mỗi tình huống một cuộc mới.

### `pnpm chatbot-check --api http://localhost` trên dữ liệu demo (2026-11-21)

- Lần đầu: tìm "túi tầm 7 triệu" và "black sneakers under 4 million" không ra gì (lỗi tìm theo từ khóa ở trên); bảo hành Coach Tabby bị trả lời là không có vì model không gọi `get_product`.
- Lần chạy đầy đủ sau khi sửa tìm kiếm và prompt đúng 7/9; hai lỗi còn lại (câu trả lời tìm túi bị vỡ chữ do nhiều lời nhắc ngôn ngữ, link chính sách bịa) được sửa tiếp. Sau lần sửa cuối, chạy hai lần và đọc lại ba tình huống bị ảnh hưởng (tìm túi, bảo hành, tiếng Anh): đều đúng. Kết quả theo từng tình huống:
  - Michael Kors trong ngân sách (đúng là đang hết hàng);
  - size theo bảng đo kèm câu miễn trừ, màu đen size 41 còn hàng;
  - đổi trả 7 ngày;
  - bảo hành khóa và đường may 12 tháng, link `/trang/chinh-sach-bao-hanh`;
  - hỏi đơn thì chỉ tới Tra cứu đơn; không tự đưa mã giảm giá;
  - đề nghị chuyển nhân viên mà không nói "đã chuyển";
  - câu tiếng Anh trả lời tiếng Anh, Air Max 90 đen 3.490.000;
  - từ chối viết code.
- Thời gian: 0,5–5 giây mỗi tin; có lần 10–12 giây khi Groq trả 429 và chuỗi chuyển model.
