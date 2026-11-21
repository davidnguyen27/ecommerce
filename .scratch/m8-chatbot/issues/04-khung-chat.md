# 04: Khung chat trên web khách

**What to build:** Nút chat nổi ở mọi trang web khách, trừ trang đặt mua và thanh toán. Mở ra là khung chat có dòng quyền riêng tư, chữ hiện dần theo stream, thẻ sản phẩm, nút "Gặp nhân viên". Chatbot không trả lời được thì khung chat nói rõ và vẫn cho gửi yêu cầu. Lỗi của khung chat không ảnh hưởng trang.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Component tải sau trang (lazy); không có trên trang đặt mua và thanh toán.
- [ ] Điện thoại: toàn màn hình; máy tính: khung ở góc dưới.
- [ ] Dòng quyền riêng tư kèm link chính sách bảo mật.
- [ ] Mã cuộc trò chuyện giữ trong `localStorage` (bọc try/catch); tải lại các tin khi mở; nút "Bắt đầu lại".
- [ ] Trang sản phẩm gửi slug đang xem cùng mỗi tin.
- [ ] Stream chữ; thẻ sản phẩm có ảnh, tên, giá, tình trạng, link.
- [ ] Trạng thái tắt / hết lượt / lỗi: thông báo tương ứng kèm nút gửi yêu cầu và link trang chính sách.
- [ ] Nút "Gặp nhân viên" luôn hiện; khi có sự kiện "đề nghị chuyển" thì nút nổi bật. Form chuyển làm ở ticket 05; ticket này chỉ mở được form rỗng hoặc dẫn tới trang liên hệ.
- [ ] Soạn nháp đoạn về chatbot cho chính sách bảo mật, ghi vào mục Comments của ticket để chủ doanh nghiệp duyệt.
- [ ] Test component (vitest): hiện thẻ từ sự kiện; trạng thái hết lượt hiện nút gửi yêu cầu; `localStorage` ném lỗi thì vẫn chat được.

Spec: "Web".
