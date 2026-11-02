# 08: Chuẩn bị và bàn giao vận chuyển

**What to build:**
- Nhân viên kho đánh dấu đơn đang chuẩn bị, rồi ghi bàn giao vận chuyển với đơn vị vận chuyển và mã vận đơn.
- Hàng rời tồn lúc bàn giao (ADR 0007): trừ cả tồn và số đang giữ, sổ xuất nhập ghi dòng xuất bán có tham chiếu tới đơn.

**Blocked by:** 07 (Đơn hàng ở trang quản trị)

**Status:** ready-for-agent

- [ ] Sổ xuất nhập có loại mới `sale` và cột `order_id`, kèm check: dòng loại `sale` bắt buộc có đơn. Trang Sổ xuất nhập hiện loại "Xuất bán" kèm link tới đơn
- [ ] Hai chuyển trạng thái `not_prepared` → `preparing` và `preparing` → `handed_over`:
  - cần quyền `order.fulfill`, đi qua `audited()`;
  - chỉ làm được khi thanh toán đã `paid`;
  - sai cạnh trạng thái thì 409.
- [ ] Bàn giao bắt buộc có `carrier` và `trackingNumber`. Trong một transaction:
  1. khóa các biến thể theo thứ tự id;
  2. trừ `on_hand` và `reserved`;
  3. ghi một dòng sổ `sale` cho mỗi dòng đơn.
- [ ] Trang chi tiết đơn có nút chuẩn bị và form bàn giao
- [ ] Có test qua HTTP:
  - chuẩn bị rồi bàn giao: `on_hand` và `reserved` cùng giảm, sổ có dòng `sale` tham chiếu tới đơn;
  - bàn giao thiếu mã vận đơn thì 400 theo trường;
  - sai cạnh trạng thái thì 409;
  - đơn chưa trả tiền không chuẩn bị được;
  - thiếu `order.fulfill` thì 403;
  - mỗi thao tác đều ghi audit
