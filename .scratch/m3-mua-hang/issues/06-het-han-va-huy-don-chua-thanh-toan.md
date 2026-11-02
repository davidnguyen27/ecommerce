# 06: Hết hạn và hủy đơn chưa thanh toán

**What to build:**
- Đơn chưa thanh toán quá 15 phút thì tự hủy và nhả hàng.
- Khách tự hủy đơn chưa thanh toán qua link token hoặc trong tài khoản. Nhân viên hủy hộ khi khách gọi báo thôi.
- Tiền về sau khi đơn đã hủy thì cần đối soát, đơn vẫn giữ trạng thái hủy.
- Cổng giả lập có nút "Giả lập hết hạn".

**Blocked by:** 05 (Ghi nhận thanh toán)

**Status:** ready-for-agent

- [ ] Một hàm hủy đơn dùng chung cho hết hạn, khách hủy và nhân viên hủy:
  - khóa đơn; chỉ hủy đơn còn `pending_payment`, đơn đã trả thì trả 409;
  - nhả giữ hàng;
  - ghi sự kiện đơn với đúng actor;
  - gọi cổng hủy link; lỗi khi hủy link chỉ log, không chặn.

  Chạy lại trên đơn đã hủy thì không đổi gì.
- [ ] Hết hạn có hai cơ chế:
  - khi tạo đơn, xếp job pg-boss `expire-order` chạy đúng lúc hết hạn;
  - job định kỳ mỗi phút quét các đơn `pending_payment` đã quá hạn.

  Job chỉ hủy đơn đã quá hạn tính theo `now`.
- [ ] Endpoint hủy:
  - khách vãng lai: `POST /api/orders/:code/cancel?token=…`;
  - khách đăng nhập: `POST /api/account/orders/:code/cancel`, chỉ hủy được đơn của chính mình, đơn của người khác trả 404;
  - nhân viên: `POST /api/admin/orders/:code/cancel`, cần quyền `order.fulfill`, đi qua `audited()`. Nút hủy ở admin làm ở ticket 07.
- [ ] Thêm test cho nhánh tiền về sau khi đơn đã hủy: cần đối soát `paid_after_cancel`
- [ ] Web:
  - nút hủy trong `OrderView`, chỉ hiện khi đơn còn chờ thanh toán;
  - gắn nút vào trang đơn qua token, và vào trang đơn trong tài khoản nếu ticket 11 đã có trang đó (nếu chưa, ticket 11 sẽ gắn);
  - đơn hết hạn hiện rõ, kèm nút quay lại giỏ hàng;
  - cổng giả lập có nút "Giả lập hết hạn".
- [ ] Không gửi email khi đơn hết hạn hay khi khách tự hủy
- [ ] Có test. Job hết hạn được gọi thẳng với `now` ở tương lai, kết quả kiểm qua HTTP:
  - hết hạn thì nhả giữ hàng và hủy link; chạy lại không đổi gì; không động tới đơn đã trả hay đơn chưa quá hạn;
  - khách hủy được bằng token và bằng tài khoản; token sai hoặc đơn của người khác thì không hủy được; không hủy được đơn đã trả;
  - nhân viên hủy cần `order.fulfill` và có ghi audit;
  - tiền về sau khi hủy: cần đối soát, đơn vẫn hủy
