# 02: Mã giảm giá ở trang quản trị

**What to build:**
- Nhân viên bán hàng tạo, sửa, tắt mã giảm giá, và xem danh sách mã kèm số lượt đã dùng. Chưa có đơn nào dùng mã (ticket 03), nhưng cột tham chiếu trên đơn và hàm đếm lượt được làm ở đây để áp quy tắc khóa.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] Bảng mã giảm giá như spec mục "Mã giảm giá", kèm hai bảng nối phạm vi (thương hiệu, danh mục). Check: `percent` thì giá trị 1–50 và có mức tối đa; `fixed` thì giá trị ≥ 1.000 và không có mức tối đa; đơn tối thiểu ≥ 0; kết thúc sau bắt đầu; tổng lượt ≥ 1 nếu có; lượt mỗi khách ≥ 1. Mã lưu chữ hoa, chỉ gồm chữ và số, dài 4–20, duy nhất
- [ ] Thêm cột `order.voucher_id` (nullable, FK, index) ngay ở ticket này, để viết được hàm đếm lượt. Các cột chụp mã và tiền giảm thêm ở ticket 03
- [ ] Hàm `usedRedemptions(db, voucherIds)` đếm đơn chưa `cancelled` theo mã, và `customerRedemptions(db, voucherId, email, phone)` đếm theo email (chữ thường) **hoặc** số điện thoại. Test dựng đơn bằng `prisma`
- [ ] Trạng thái tính khi đọc: sắp tới, đang chạy, hết hạn, đã tắt. Tắt ghi `disabled_at` và không bật lại được
- [ ] Sửa: chưa có lượt dùng thì sửa được mọi trường trừ chuỗi mã; đã có lượt thì chỉ sửa được mô tả, thời điểm kết thúc, tổng lượt (không thấp hơn số đã dùng) và tắt. Vi phạm trả 409. Mã trùng (khác hoa thường) trả 409
- [ ] Quyền mới `voucher.manage` (owner, sales) cho thao tác ghi; xem được với `voucher.manage` **hoặc** `order.view`. Mọi thao tác ghi đi qua `audited()`: `voucher.create`, `voucher.update` (trước và sau, chỉ các trường đổi), `voucher.disable`
- [ ] API `/api/admin/vouchers`: danh sách (lọc trạng thái, tìm theo mã, `PageQuery`, kèm số lượt đã dùng), chi tiết (kèm phạm vi), tạo, sửa, tắt. Không có endpoint xóa. Schema trong `@ecommerce/shared`
- [ ] Web admin: mục "Mã giảm giá" trong `ADMIN_MENU_ITEMS`, danh sách, form tạo/sửa (khóa các trường không sửa được khi đã có lượt dùng, dùng lại bộ chọn thương hiệu và danh mục sẵn có), trang chi tiết, nút tắt kèm hỏi xác nhận
- [ ] Test qua HTTP: tạo/sửa/tắt; mã trùng 409; tỷ lệ > 50, thiếu mức tối đa, mã sai định dạng thì 400; sửa trường bị khóa khi đã có lượt 409; giảm tổng lượt dưới số đã dùng 409; thiếu `voucher.manage` 403; `order.view` xem được nhưng không ghi được; audit ghi đủ

Spec: mục "Mã giảm giá", "Quyền", "API quản trị".
