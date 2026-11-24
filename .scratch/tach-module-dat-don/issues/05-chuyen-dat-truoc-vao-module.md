# 05: Chuyển đặt trước vào module

**What to build:**
- Thêm entry point `preorder` và plan đặt trước vào `orderPlacement`. Handler `POST /api/preorders` chỉ còn parse body, giới hạn theo IP, dựng `Placer`, gọi `placement.preorder` và trả 201. Hết đoạn tạo đơn bị chép.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Plan đặt trước (nội bộ, không export):
  - Kiểm `acceptPreorderPolicy` ở bước 1, đọc chính sách đặt trước ở bước 4 (503 khi chưa công bố).
  - `checkPreorder({ lock: true })`, rồi dừng ở thay đổi đầu tiên theo thứ tự `discontinued`, `in_stock`, `campaign`, `price`, `deposit`, `sold_out`.
- [ ] Bảng thông điệp `conflict()` và `policyUnavailable()` chuyển từ `routes/preorders.ts` vào module (hoặc file plan cạnh nó), giữ nguyên từng chữ.
- [ ] Đơn chỉ có một dòng, và dòng nhận toàn bộ tiền giảm như hôm nay.
- [ ] Đơn có cột đợt và tiền cọc, tính qua `priceOrder` trên tiền hàng sau giảm.
- [ ] Phiên bản chính sách đặt trước được thêm vào `policyVersions`.
- [ ] Sự kiện `created` thêm `depositAmount` và `campaignId`. Thanh toán dùng mục đích `deposit`, số tiền là tiền cọc, mô tả `Đặt cọc đơn hàng #…`.
- [ ] Nếu `place-order.ts` vượt khoảng 250 dòng thì tách plan ra `orders/dat-mua.ts` và `orders/dat-truoc.ts`, không export ra ngoài `orders/`.
- [ ] `preorder*.test.ts`, `checkout*.test.ts` và cả bộ test của api xanh mà không sửa.
- [ ] Typecheck và lint sạch. `pnpm smoke` và E2E đặt mua, đặt trước xanh.

Spec: mục "Bên trong module", "Lỗi" (409 đặt trước).
