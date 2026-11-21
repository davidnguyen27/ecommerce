# 03: Công cụ và thẻ sản phẩm

**What to build:** Chatbot tìm được sản phẩm, đọc chi tiết sản phẩm (biến thể, bảng size, đợt đặt trước), đọc chính sách và đề nghị chuyển nhân viên. Mỗi sản phẩm tìm được đi kèm một thẻ sản phẩm dựng từ DB. Sản phẩm khách đang xem được đưa sẵn vào ngữ cảnh.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Vòng lặp gọi công cụ: tối đa 3 vòng, sau đó gọi một lần không kèm công cụ để buộc trả lời.
- [ ] `search_products`: dùng lại `searchPage`; tối đa 5 sản phẩm; tên, slug, thương hiệu, khoảng giá, còn/hết/đang nhận đặt trước. Ảnh không gửi cho model.
- [ ] `get_product`: mô tả cắt còn khoảng 600 ký tự, thuộc tính, biến thể kèm giá và còn/hết, bảng size, hướng dẫn sử dụng và bảo quản, thông tin nguồn gốc công bố, cam kết có bằng chứng đang hiện công khai, đợt đặt trước đang mở, các trang chính sách liên kết.
- [ ] `list_policies`, `get_policy`: chỉ trang đã xuất bản, kèm link.
- [ ] `handoff`: chỉ trả tóm tắt; API gửi sự kiện "đề nghị chuyển" về khung chat, không tạo yêu cầu.
- [ ] Ngữ cảnh trang: slug sản phẩm đang xem được đọc và đưa vào system message.
- [ ] Sự kiện SSE thẻ sản phẩm: ảnh, tên, giá, tình trạng, link, lấy từ kết quả công cụ. Lưu slug và tên của thẻ vào `chat_message`.
- [ ] Test:
  - công cụ chạy đúng tham số; quá 3 vòng thì buộc trả lời;
  - sản phẩm nháp, ẩn, lưu trữ không xuất hiện; trang chính sách nháp không đọc được;
  - không trả số tồn, giá vốn, chứng từ;
  - model viết giá sai thì thẻ vẫn đúng giá;
  - mô tả sản phẩm chèn lệnh chỉ đi vào kết quả công cụ, không vào system prompt;
  - `handoff` không tạo yêu cầu nào.
- [ ] Chạy `scripts/chatbot-check.ts` trên chuỗi thật với dữ liệu seed; ghi kết quả vào mục "Quyết định khi triển khai".

Spec: "Công cụ".
