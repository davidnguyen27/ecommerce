# 06: Mã giảm giá trong đơn ở trang quản trị

**What to build:**
- Nhân viên thấy mã và tiền giảm ở chi tiết đơn, lọc được danh sách đơn theo mã, và xem từ trang chi tiết mã những đơn nào đã dùng nó.

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] Chi tiết đơn ở API admin trả thêm mã, loại và giá trị lúc đặt, tiền giảm, tiền hàng sau giảm, tiền giảm từng dòng
- [ ] Danh sách đơn ở API admin thêm bộ lọc theo mã giảm giá (theo chuỗi mã, không phân biệt hoa thường)
- [ ] Chi tiết mã ở API admin thêm danh sách đơn đã dùng (mã đơn, khách, trạng thái, tiền giảm, thời điểm), phân trang `PageQuery`, gồm cả đơn đã hủy nhưng đánh dấu là không tính lượt
- [ ] Web admin: khối tiền của chi tiết đơn có dòng mã giảm giá; danh sách đơn có ô lọc theo mã; trang chi tiết mã có bảng đơn đã dùng, mỗi dòng dẫn tới chi tiết đơn. Phiếu soạn hàng không đổi
- [ ] Test qua HTTP: chi tiết đơn có đủ trường; lọc theo mã trả đúng đơn; danh sách đơn của mã đúng và đơn hủy được đánh dấu; quyền theo `order.view` như các API đơn hiện có

Spec: mục "API quản trị", "Web" (admin).
