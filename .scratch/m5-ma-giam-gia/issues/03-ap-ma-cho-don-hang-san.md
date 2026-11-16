# 03: Áp mã cho đơn hàng sẵn

**What to build:**
- Khách gõ mã ở trang đặt mua, thấy tiền giảm, phí giao và tổng mới, hoặc lý do mã không dùng được; xác nhận thì đơn được tạo với phần giảm đã chụp và link thanh toán đúng số tiền sau giảm. Mã vừa hết hiệu lực lúc xác nhận thì khách được báo và tự chọn đặt tiếp không mã hay thôi.

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] Migration: `order` thêm chuỗi mã, loại, giá trị, mức tối đa lúc đặt và `discount` (mặc định 0); `order_line` thêm `discount` (mặc định 0). Đổi check thành `total = subtotal - discount + shipping_fee` và thêm `0 <= discount <= subtotal`. Đơn cũ thỏa check mới
- [ ] Một hàm kiểm mã dùng chung cho báo giá và tạo đơn: nạp mã theo chuỗi (không phân biệt hoa thường), kiểm `not_found`, `disabled`, `not_started`, `expired`, `sale_type`, `exhausted`, `customer_limit` (chỉ khi có email hoặc số điện thoại), rồi gọi hàm tính giảm của ticket 01
- [ ] Phí giao: ngưỡng miễn phí giao so với `subtotal - discount`
- [ ] `POST /api/checkout/quote` nhận `voucherCode`, email, số điện thoại (tùy chọn); trả `voucher` (áp được: mã, tiền giảm, từng dòng; không áp được: mã, lý do, `details`) cùng tổng khi không có mã và tổng khi có mã. Không ghi gì
- [ ] Báo giá có `voucherCode` dùng thêm bucket giới hạn tần suất theo IP, 10 lần mỗi phút (`http/rate-limit.ts`); vượt thì 429
- [ ] `POST /api/checkout` nhận `voucherCode` và `discount` khách đã thấy. Trong transaction, sau khi khóa biến thể như M3: khóa dòng mã `FOR UPDATE`, kiểm lại toàn bộ, tính lại. Mã không còn dùng được, hoặc tiền giảm khác số khách thấy, thì 409 với `details` gồm lý do, tiền giảm mới (nếu có) và tổng khi không có mã; không ghi gì. Đủ điều kiện thì chụp phần giảm vào đơn và dòng đơn; link thanh toán bằng `total` sau giảm
- [ ] Email đã nhận thanh toán và trang đơn hàng (token và tài khoản) hiện dòng "Mã giảm giá `XXX` −số tiền" khi đơn có mã
- [ ] Web khách: trang đặt mua có ô "Mã giảm giá" với nút Áp dụng và Gỡ, hiện lý do bằng tiếng Việt cho từng mã lỗi, bảng tiền thêm dòng giảm và cập nhật phí giao, tổng. Nhận 409 về mã thì hộp thoại hiện lý do, tổng khi không có mã, hai nút "Đặt không dùng mã" và "Quay lại". Giỏ hàng không có ô nhập mã
- [ ] Test qua HTTP: mỗi lý do trả đúng ở báo giá; lượt mỗi khách chỉ kiểm khi có email hoặc số điện thoại; phí giao đổi khi tiền hàng sau giảm xuống dưới ngưỡng; 429 khi vượt tần suất; đơn và dòng đơn chụp đúng phần giảm; `total` và số tiền link đúng; mã hết hạn, đã tắt, hết lượt, khách đã dùng, tiền giảm lệch đều 409 và không ghi gì; nhiều khách tranh lượt cuối song song thì đúng một đơn có mã; lượt mỗi khách nhận diện qua email khác hoa thường và qua số điện thoại; hủy và hết hạn đơn chưa trả thì lượt trống lại; IPN lặp không đổi lượt hay tiền giảm

Spec: mục "Mô hình đơn", "Đặt mua và đặt trước", "Hủy, hết hạn, đối soát", "Email", "Web".
