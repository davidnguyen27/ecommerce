# 11: Đơn hàng trong tài khoản khách

**What to build:**
- Khách đã đăng nhập thấy lịch sử mua và chi tiết từng đơn trong trang tài khoản.
- Đơn vãng lai cùng email tự gắn vào tài khoản sau khi khách xác minh email.
- Form đặt mua tự điền địa chỉ khách đã dùng lần trước.

**Blocked by:** 03 (Đặt mua và giữ hàng)

**Status:** ready-for-agent

- [ ] Khách đã đăng nhập đặt mua thì đơn gắn `customer_id`, và địa chỉ lần trước trên khách hàng được ghi đè (chỉ một bản, chỉ khi đặt mua thành công)
- [ ] Xác minh email thành công thì các đơn chưa có `customer_id` và cùng email (so chữ thường) được gắn vào khách đó, trong cùng transaction. Email chưa xác minh thì không gắn
- [ ] `GET /api/account/orders` (có phân trang) và `GET /api/account/orders/:code`. Đơn của người khác trả 404
- [ ] API trả địa chỉ lần trước cho trang đặt mua, và trang đặt mua tự điền khi có
- [ ] Web: mục "Đơn hàng của tôi" trong trang tài khoản; trang chi tiết dùng lại `OrderView`. Nếu ticket 06 đã xong thì gắn nút hủy gọi `POST /api/account/orders/:code/cancel`
- [ ] Có test qua HTTP:
  - đơn của khách đăng nhập hiện trong lịch sử;
  - đơn vãng lai chỉ gắn vào tài khoản sau khi xác minh email;
  - không thấy đơn của người khác;
  - địa chỉ lần trước được trả về, và được cập nhật sau đơn mới
