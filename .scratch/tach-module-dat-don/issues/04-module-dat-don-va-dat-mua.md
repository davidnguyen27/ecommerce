# 04: Module đặt đơn, chuyển đặt mua vào

**What to build:**
- Tạo `orderPlacement(deps)` với pipeline cố định thứ tự các bước và plan đặt mua. Handler `POST /api/checkout` chỉ còn parse body, giới hạn theo IP, dựng `Placer`, gọi `placement.checkout` và trả 201.

**Blocked by:** 01, 02, 03

**Status:** resolved

- [x] `api/src/orders/place-order.ts` export `orderPlacement`, `PlacementDeps` và `Placer` đúng như spec. Chưa có entry point `preorder` (ticket 05).
- [x] Pipeline chạy 10 bước theo đúng thứ tự trong mục "Bất biến module bảo đảm", trong một transaction `{ timeout: 30_000, maxWait: 10_000 }`.
- [x] Bất biến được ghi một lần ở đầu pipeline: thứ tự khóa, mã giảm giá kiểm sau dòng, link thanh toán gọi sau cùng. Comment tương ứng trong route bị xóa.
- [x] Plan đặt mua làm các việc sau, nội bộ, không export:
  - gom mọi dòng sai (`discontinued`, `price`, `out_of_stock`) theo thứ tự input;
  - giữ hàng các dòng đúng trước khi ném 409;
  - tiền giảm từng dòng lấy từ `applied.lines`;
  - mục đích thanh toán `full`.
- [x] Mọi thông điệp lỗi, `fields`, body 409 và mã trạng thái giữ nguyên từng chữ, gồm cả 400, 429, 503 và 502.
- [x] `routes/checkout.ts` không còn import `wardName`, `reserveStock`, `cartVariants` (ngoài báo giá), `applyVoucherToOrder`, `voucherSnapshot`, `createOrderPaymentLink`, `enforcePendingOrderLimit`, `hashOpaqueToken`, `newOpaqueToken`, `recordOrderEvent`.
- [x] Bước 1 của pipeline phân biệt đặt mua và đặt trước bằng tham số nội bộ, không bằng union ở interface.
- [x] `checkout*.test.ts`, `admin-orders-voucher.test.ts`, `payment-links.test.ts`, `order-cancel.test.ts` và cả bộ test của api xanh mà không sửa.

Spec: mục "Interface của module", "Bất biến module bảo đảm", "Lỗi", "Bên trong module".

**Quyết định khi triển khai (2026-11-24):**
- **Lệch spec: giới hạn theo IP nằm trong module, không ở route.** Route cũ kiểm các lỗi 400 (đồng ý chính sách, phường/xã) *trước* khi đếm `checkoutPerIp`. Nếu để giới hạn ở route trước lời gọi module thì thứ tự bị đảo: body sai cũng bị đếm, và lần thứ 6 nhận 429 thay vì 400. Module giờ đếm ngay sau bước 1, ngoài transaction, với thông điệp riêng của mỗi loại đơn (`plan.tooManyAttempts`). `Placer` chỉ còn dữ liệu thuần, không có hook. Đã thêm test HTTP vào `checkout-guards.test.ts`: 6 lần lỗi 400 từ một IP thì lần đặt đúng sau đó vẫn 201.
- Để module gọi được `enforceRateLimits`, hàm này bỏ tham số `res` và ném 429 kèm `retryAfter` (ticket 01). Việc này nằm trong Out of Scope của spec nhưng chỉ là đổi máy móc: sửa cả 13 nơi gọi, `quoteVoucher` bỏ `res`, và `createRemainderLink` bỏ `res` khỏi `deps`.
- Plan là `Plan<Input>` nội bộ, gồm `verb`, `saleType`, `tooManyAttempts`, `checkInput?` và `claim`. `claim` trả `Claim` gồm dòng đơn, dòng cho mã giảm giá, tiền hàng, biến thể để chụp chính sách, `depositPercent?`, `voucherConflictDetails` và `settle`. `settle` nhận tổng và tiền cọc, trả cột riêng, chính sách thêm, dữ liệu sự kiện và thanh toán.
- Tiền giảm từng dòng lấy từ `applied.lines` cho cả hai loại đơn. Đơn đặt trước một dòng nên dòng nhận toàn bộ tiền giảm, như trước.
- Commit này đã có sẵn plan đặt trước và entry point `preorder` trong module, nhưng route đặt trước chưa dùng. Ticket 05 nối route vào.
- `pnpm --filter api test`: 84 file, 820 test xanh trước khi thêm test 400. Sau đó `checkout-guards.test.ts` xanh 12/12. Typecheck, ESLint và Prettier sạch.
