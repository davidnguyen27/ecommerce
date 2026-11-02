# 05: Ghi nhận thanh toán

**What to build:**
- Tiền về đúng số thì đơn thành đã trả đủ, và khách nhận email xác nhận. Có hai đường ghi nhận: webhook của cổng, và truy vấn khi khách quay về trang kết quả.
- Tiền về lệch, về thêm, hoặc về cho đơn đã hủy thì đơn được gắn cờ cần đối soát. Hệ thống không tự xử lý.
- Cổng giả lập có nút "Giả lập đã thanh toán", để đi trọn luồng khi chạy local.

**Blocked by:** 03 (Đặt mua và giữ hàng)

**Status:** ready-for-agent

- [ ] Bảng giao dịch thanh toán chỉ ghi thêm, trigger chặn sửa và xóa. Mỗi giao dịch có: đơn, số tiền, mã tham chiếu (unique), thời điểm, nguồn (`webhook`, `query` hoặc `simulator`), payload gốc
- [ ] Cờ cần đối soát, đặt trên đơn hoặc ở bảng riêng, gồm:
  - lý do: `amount_mismatch`, `paid_after_cancel` hoặc `extra_payment`;
  - số tiền nhận và thời điểm;
  - trạng thái `open` hoặc `resolved`.
- [ ] Chỉ có một hàm ghi nhận thanh toán, chạy nhiều lần vẫn cho một kết quả:
  1. Khóa đơn `FOR UPDATE`.
  2. Giao dịch đã ghi rồi thì bỏ qua.
  3. Đơn đang `pending_payment` và tổng đã nhận bằng đúng tổng phải trả: chuyển sang `paid` + `processing`, bỏ hạn giữ hàng, ghi sự kiện đơn, xếp email "đã nhận thanh toán" trong cùng transaction.
  4. Mọi trường hợp khác: gắn cờ cần đối soát kèm lý do, không đổi trạng thái đơn.
- [ ] Hàm thuần kiểm chữ ký webhook PayOS: HMAC-SHA256 trên `data`, key xếp theo alphabet, `null` đổi thành chuỗi rỗng
- [ ] `POST /api/payments/payos/webhook` không cần đăng nhập:
  - sai chữ ký thì trả 400, không ghi gì;
  - đã xử lý, hoặc giao dịch đã ghi từ trước, thì trả 2xx.
- [ ] `GET /api/orders/:code?token=…&refresh=1` truy vấn cổng theo mã đơn, ghi nhận các giao dịch mới, rồi mới trả đơn
- [ ] Trang kết quả thanh toán (`returnUrl`) tự gọi `refresh=1`
- [ ] Cổng giả lập có nút "Giả lập đã thanh toán" (đúng số tiền) và cho nhập số tiền khác để thử trường hợp lệch tiền
- [ ] Email "đã nhận thanh toán" gồm tóm tắt đơn, tổng tiền và link tra cứu. Nội dung là bản nháp, chờ chủ doanh nghiệp duyệt
- [ ] Có test qua HTTP, webhook tự ký bằng checksum key của test:
  - đúng chữ ký, đúng tiền: đơn thành đã trả đủ, email gửi đúng một lần;
  - sai chữ ký: 400, không ghi gì;
  - cùng một webhook gửi hai lần: chỉ ghi một giao dịch;
  - `refresh=1` ghi nhận được khi chưa có webhook;
  - webhook và truy vấn cùng về: chỉ ghi một lần;
  - lệch tiền: cần đối soát, đơn vẫn chưa thanh toán;
  - tiền về thêm cho đơn đã trả: cần đối soát `extra_payment`;
  - bảng giao dịch không sửa, không xóa được (thử bằng SQL trực tiếp)

**Điểm dừng:** xong ticket này, người dùng tự đi thử luồng giỏ → đặt mua → giả lập thanh toán trên máy rồi mới chạy tiếp.
