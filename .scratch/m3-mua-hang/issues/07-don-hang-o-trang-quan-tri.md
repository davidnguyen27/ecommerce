# 07: Đơn hàng ở trang quản trị

**What to build:**
- Nhân viên xem danh sách đơn, lọc theo ba trạng thái, tìm theo mã đơn, số điện thoại hoặc email.
- Chi tiết đơn có lịch sử thao tác (ai làm gì, lúc nào), thông tin xuất hóa đơn và các giao dịch thanh toán. Phiếu soạn hàng in được.
- Nhân viên hủy đơn chưa thanh toán từ trang chi tiết.

**Blocked by:** 06 (Hết hạn và hủy đơn chưa thanh toán)

**Status:** ready-for-agent

- [ ] Thêm hai quyền mới vào shared và seed vai trò:
  - `order.view`: owner, sales, warehouse, accountant;
  - `order.fulfill`: owner, warehouse.
- [ ] API danh sách đơn:
  - lọc theo trạng thái đơn hàng, thanh toán, giao hàng;
  - tìm theo mã đơn, số điện thoại, email;
  - phân trang bằng `PageQuery`;
  - mặc định hiện đơn đã trả đủ đang chờ soạn, đơn cũ trước.
- [ ] API chi tiết đơn trả: dòng đơn, thông tin nhận hàng, thông tin hóa đơn, giao dịch thanh toán, và lịch sử thao tác (sự kiện đơn gộp với audit theo thời gian, actor có tên)
- [ ] Web:
  - menu "Đơn hàng" trong `ADMIN_MENU_GROUPS`, quyền `order.view`;
  - trang danh sách và trang chi tiết;
  - nút hủy đơn chưa thanh toán, chỉ hiện với `order.fulfill`;
  - phiếu soạn hàng in bằng CSS print: SKU, tên sản phẩm, thuộc tính, số lượng, địa chỉ nhận, mã đơn.
- [ ] Có test qua HTTP:
  - thiếu `order.view` thì 403;
  - lọc và tìm cho kết quả đúng;
  - chi tiết có lịch sử với đủ ba loại actor: khách, hệ thống, nhân viên;
  - thông tin hóa đơn hiện ở chi tiết

**Ghi chú:** ticket này phụ thuộc 06 chứ không chỉ 05, vì nút hủy của nhân viên dùng hàm hủy đơn của 06, và lịch sử thao tác cần có đủ sự kiện hủy và hết hạn.
