# 05: Chuyển đặt trước vào module

**What to build:**
- Thêm entry point `preorder` và plan đặt trước vào `orderPlacement`. Handler `POST /api/preorders` chỉ còn parse body, giới hạn theo IP, dựng `Placer`, gọi `placement.preorder` và trả 201. Hết đoạn tạo đơn bị chép.

**Blocked by:** 04

**Status:** resolved

- [x] Plan đặt trước (nội bộ, không export):
  - Kiểm `acceptPreorderPolicy` ở bước 1, đọc chính sách đặt trước ở bước 4 (503 khi chưa công bố).
  - `checkPreorder({ lock: true })`, rồi dừng ở thay đổi đầu tiên theo thứ tự `discontinued`, `in_stock`, `campaign`, `price`, `deposit`, `sold_out`.
- [x] Bảng thông điệp `conflict()` và `policyUnavailable()` chuyển từ `routes/preorders.ts` vào module (hoặc file plan cạnh nó), giữ nguyên từng chữ.
- [x] Đơn chỉ có một dòng, và dòng nhận toàn bộ tiền giảm như hôm nay.
- [x] Đơn có cột đợt và tiền cọc, tính qua `priceOrder` trên tiền hàng sau giảm.
- [x] Phiên bản chính sách đặt trước được thêm vào `policyVersions`.
- [x] Sự kiện `created` thêm `depositAmount` và `campaignId`. Thanh toán dùng mục đích `deposit`, số tiền là tiền cọc, mô tả `Đặt cọc đơn hàng #…`.
- [x] Nếu `place-order.ts` vượt khoảng 250 dòng thì tách plan ra `orders/dat-mua.ts` và `orders/dat-truoc.ts`, không export ra ngoài `orders/`.
- [x] `preorder*.test.ts`, `checkout*.test.ts` và cả bộ test của api xanh mà không sửa.
- [x] Typecheck và lint sạch. `pnpm smoke` và E2E đặt mua, đặt trước xanh.

Spec: mục "Bên trong module", "Lỗi" (409 đặt trước).

**Quyết định khi triển khai (2026-11-24):**
- `place-order.ts` lên tới 439 dòng nên đã tách thành bốn file trong `orders/`:
  - `place-order.ts` (204 dòng): interface và pipeline.
  - `dat-mua.ts` và `dat-truoc.ts`: hai plan.
  - `placement-plan.ts`: kiểu nội bộ `Plan`, `Claim`, `LineDraft`, `PlacementInput`.
  
  `place-order.ts` chỉ export `orderPlacement`, `PlacementDeps` và `Placer`. Các file kia chỉ được import trong `orders/`.
- Bảng thông điệp 409 chuyển vào `dat-truoc.ts` (`preorderConflict`). Thông điệp 503 của chính sách đặt trước nằm ngay trong `claim`, giữ nguyên từng chữ.
- `routes/checkout.ts` còn 96 dòng, `routes/preorders.ts` còn 115 dòng. Phần còn lại của cả hai là báo giá.
- Kiểm tra:
  - `pnpm --filter api test`: 84 file, 821 test xanh.
  - Typecheck, ESLint và Prettier sạch.
  - `pnpm smoke --keep` đạt.
  - E2E `purchase`, `preorder`, `voucher`: 4/4 xanh. Máy chưa có Chromium của Playwright nên đã chạy `playwright install chromium` trước.
