# 02: Đợt đặt trước ở trang quản trị

**What to build:**
- Nhân viên bán hàng tạo, sửa, đóng đợt đặt trước cho một sản phẩm, gồm: biến thể và số suất từng biến thể, tỷ lệ cọc, thời gian giao dự kiến, hạn đóng nhận đặt, số ngày được trả phần còn lại, trạng thái nhập hàng kèm ghi chú nội bộ.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] Bảng đợt và bảng biến thể của đợt như spec. Ràng buộc: tỷ lệ cọc 10–100, suất ≥ 1, số ngày ≥ 1 (mặc định 7), ngày giao "từ" ≤ "đến", mỗi biến thể một lần trong một đợt, biến thể phải thuộc sản phẩm của đợt
- [ ] Đợt đang mở khi `closed_at` trống và chưa tới hạn đóng. Mỗi sản phẩm tối đa một đợt đang mở: khóa sản phẩm `FOR UPDATE` khi tạo, trùng thì 409. Không tạo được đợt cho sản phẩm chưa xuất bản hoặc đã lưu trữ
- [ ] Sửa: thời gian giao dự kiến, hạn đóng, suất, thêm biến thể, trạng thái nhập hàng (`not_ordered`, `ordered`, `in_transit`, `issue`) và ghi chú. Đóng tay ghi `closed_at`, không mở lại được
- [ ] Viết sẵn hàm "số đã dùng" (tổng số lượng của đơn đặt trước chưa hủy của đợt theo biến thể) và áp các quy tắc khóa: giảm suất dưới số đã dùng thì 409; đợt đã có đơn thì không sửa tỷ lệ cọc, số ngày, không bỏ biến thể đã có đơn (409). Trước ticket 04 chưa có đơn nào, nên test dựng đơn bằng `prisma`
- [ ] Quyền mới `preorder.manage` (owner, sales) cho thao tác ghi; `order.view` để xem. Mọi thao tác ghi đi qua `audited()`
- [ ] API: danh sách (lọc đang mở/đã đóng, theo sản phẩm, `PageQuery`), chi tiết (từng biến thể: suất, số đã dùng), tạo, sửa, đóng. Schema trong `@ecommerce/shared`
- [ ] Web admin: mục "Đặt trước" trong `ADMIN_MENU_ITEMS` (danh sách đợt, form tạo/sửa, nút đóng)
- [ ] Test qua HTTP: tạo/sửa/đóng; đợt thứ hai đang mở cho cùng sản phẩm 409; hết hạn đóng thì được mở đợt mới; các quy tắc khóa ở trên; 403 khi thiếu quyền; audit ghi đủ

Spec: mục "Đợt đặt trước", "Quyền".
