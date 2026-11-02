# 02: Giỏ hàng

**What to build:**
- Khách thêm biến thể đang chọn vào giỏ từ trang sản phẩm, thấy số món ở header trên mọi trang, đổi số lượng hoặc bỏ dòng ở trang giỏ hàng.
- Giỏ hàng nằm ở localStorage và còn nguyên khi tải lại trang. Trang giỏ gọi `quote` để hiện giá hiện tại và báo dòng nào đã đổi giá, hết hàng hay ngừng bán.

**Blocked by:** 01 (Phí giao theo tỉnh/thành)

**Status:** ready-for-agent

- [ ] Composable giỏ hàng trên web lưu variant id, số lượng và giá lúc thêm vào localStorage. Mọi lần đọc và ghi bọc try/catch; localStorage hỏng hoặc không dùng được thì coi như giỏ rỗng
- [ ] Nút "Thêm vào giỏ" ở trang sản phẩm theo biến thể đang chọn, khóa khi hết hàng hoặc ngừng bán. Tối đa 5 cái mỗi biến thể; đã đủ 5 thì nút báo rõ giới hạn
- [ ] Biểu tượng giỏ có số món ở header của layout khách. Số món render phía client để không lệch SSR
- [ ] Trang `/gio-hang`:
  - danh sách dòng, đổi số lượng 1–5, bỏ dòng;
  - gọi `quote` và hiện thay đổi theo dòng (giá mới, hết hàng, ngừng bán);
  - tổng tiền hàng, nút sang trang đặt mua (trang này làm ở ticket 03);
  - `noindex`, không SSR dữ liệu giỏ.
- [ ] `scripts/smoke.ts` kiểm `/gio-hang` trả 200 và có `noindex`
- [ ] Logic thuần của giỏ (cộng dồn cùng biến thể, chặn quá 5, đọc localStorage hỏng) tách thành hàm thuần và có test. Phần giao diện do E2E (ticket 14) phủ
