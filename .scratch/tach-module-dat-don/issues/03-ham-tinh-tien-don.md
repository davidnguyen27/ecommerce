# 03: Hàm tính tiền đơn `priceOrder`

**What to build:**
- Hàm thuần tính phí giao, tổng và tiền cọc từ tiền hàng và tiền giảm. Quy tắc "ngưỡng miễn phí giao và tiền cọc tính trên tiền hàng sau giảm" (spec M5) chỉ còn viết một lần. Báo giá và tạo đơn dùng chung, nên số khách thấy lúc báo giá luôn khớp số trên đơn.

**Blocked by:** —

**Status:** resolved

- [x] `api/src/orders/price-order.ts`: `priceOrder(config, { subtotal, discount, provinceCode?, depositPercent? })` trả `{ shippingFee, total, depositAmount }`.
  - Thiếu `provinceCode` thì `shippingFee` và `total` là `null`.
  - Thiếu `depositPercent` thì `depositAmount` là `null`.
  - Dùng `shippingFeeFor` và `depositFor` có sẵn trong `@ecommerce/shared`.
- [x] `POST /api/checkout/quote` dùng nó cho `shippingFee`, `total`, `shippingFeeWithoutVoucher` và `totalWithoutVoucher`.
- [x] `POST /api/preorders/quote` dùng nó thay cho hàm `amounts` cục bộ, gồm cả `depositAmountWithoutVoucher`.
- [x] Hai handler `POST /` dùng nó cho phí giao, tổng và tiền cọc của đơn, và cho các giá trị `withoutVoucher` truyền vào `applyVoucherToOrder`. Hai handler này sẽ được thay ở ticket 04, 05, nhưng dùng sớm để lưới test bắt lệch ngay từ đây.
- [x] Mọi test báo giá, đặt mua, đặt trước và mã giảm giá xanh mà không sửa.

Spec: mục "`priceOrder`".

**Quyết định khi triển khai (2026-11-24):**
- `priceOrder` có kiểu generic: truyền `provinceCode` là `string` thì `shippingFee` và `total` có kiểu `number`; truyền `string | undefined` (báo giá) thì có kiểu `number | null`. Tiền cọc cũng vậy theo `depositPercent`. Nơi tạo đơn không cần `!`.
- Báo giá đặt trước vẫn trả mọi số là `null` khi chưa có biến thể (`subtotal === null`), như trước.
- Giá trị "không mã" truyền cho `applyVoucherToOrder` ở route đặt trước đang dựng hơi vụng (IIFE). Ticket 05 xóa cả đoạn này.
- `pnpm --filter api test`: 84 file, 820 test xanh. Typecheck, ESLint và Prettier sạch.
