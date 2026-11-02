# 14: E2E mua hàng bằng Playwright

**What to build:**
- Một luồng E2E chạy bằng trình duyệt thật, trên stack của `pnpm smoke --keep`, với cổng giả lập:
  1. Khách thêm vào giỏ và đặt mua.
  2. Giả lập đã thanh toán.
  3. Nhân viên kho chuẩn bị, bàn giao, đánh dấu đã giao.

  Ở từng bước, kiểm tồn, số đang giữ, sổ xuất nhập và trạng thái đơn.
- Luồng chạy trong CI, thay cho mục "smoke admin" ghi ở ticket 15 của M0–M1.

**Blocked by:** 09 (Đã giao, giao thất bại và email giao hàng), 13 (CI trên GitHub Actions)

**Status:** ready-for-agent

- [ ] Cài Playwright ở workspace phù hợp, chỉ dùng Chromium. Lệnh `pnpm e2e` chạy trên stack đã dựng
- [ ] Viết kịch bản mua hàng như trên. Selector chọn theo vai trò hoặc nhãn (label đã được nối với ô nhập từ đợt retro); chỉ dùng `data-testid` khi không có cách khác
- [ ] Thêm kịch bản admin nhỏ từ retro: đăng nhập bằng `warehouse` thì dashboard không hiện lối tắt danh mục
- [ ] Job E2E trong `ci.yml`, chạy sau smoke; giữ trace khi đỏ
- [ ] Chạy xanh trên máy local
