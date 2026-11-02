# 09: Đã giao, giao thất bại và email giao hàng

**What to build:**
- Nhân viên kho đánh dấu đã giao (đơn hoàn tất) hoặc giao thất bại (đơn vẫn đang xử lý, chờ M6).
- Khách nhận email khi đơn đã bàn giao vận chuyển (kèm đơn vị vận chuyển và mã vận đơn) và khi giao thất bại.

**Blocked by:** 08 (Chuẩn bị và bàn giao vận chuyển)

**Status:** ready-for-agent

- [ ] Hai chuyển trạng thái, cùng cần `order.fulfill` và đi qua `audited()`; sai cạnh thì 409:
  - `handed_over` → `delivered`: đơn hàng thành `completed`;
  - `handed_over` → `failed`: đơn hàng giữ `processing`.
- [ ] Hai email, nội dung là bản nháp chờ chủ doanh nghiệp duyệt:
  - "đã bàn giao vận chuyển": đơn vị vận chuyển, mã vận đơn, link tra cứu. Xếp trong transaction bàn giao của ticket 08;
  - "giao thất bại": báo shop sẽ liên hệ.
- [ ] Trang đơn của khách hiện mã vận đơn, và trạng thái giao hàng tách khỏi trạng thái thanh toán
- [ ] Trang chi tiết đơn ở admin có hai nút "Đã giao" và "Giao thất bại"
- [ ] Có test qua HTTP:
  - đã giao: đơn hoàn tất;
  - giao thất bại: đơn vẫn đang xử lý;
  - sai cạnh trạng thái thì 409;
  - email bàn giao và email giao thất bại mỗi loại gửi đúng một lần, có đủ nội dung chính
