# 01: `Retry-After` đi theo `AppError`

**What to build:**
- Lỗi 429 mang số giây chờ trong chính `AppError`, và `errorHandler` đặt header `Retry-After` từ đó. `enforcePendingOrderLimit` không cần `res` của Express nữa. Đây là bước chuẩn bị để module đặt đơn (ticket 04, 05) không nhận kiểu Express.

**Blocked by:** —

**Status:** resolved

- [x] `AppError` có thêm trường tùy chọn `retryAfter?: number` (giây). Các nơi tạo `AppError` hiện có không phải sửa.
- [x] `errorHandler` đặt `Retry-After` khi lỗi có `retryAfter`. Response không có header này khi lỗi không mang giá trị đó.
- [x] `enforcePendingOrderLimit(tx, contact, now?)` bỏ tham số `res` và ném 429 kèm `retryAfter`. Thông điệp, `fields` và cách tính số giây giữ nguyên.
- [x] Hai route đặt mua và đặt trước gọi theo chữ ký mới.
- [x] `enforceRateLimits` giữ nguyên, vì nằm ngoài phạm vi spec.
- [x] `checkout-guards.test.ts` và mọi test khác xanh mà không sửa. Nếu chưa có test nào giữ header `Retry-After` của giới hạn đơn chờ ở route đặt trước thì thêm một test HTTP.

Spec: mục "Thay đổi ngoài module".

**Quyết định khi triển khai (2026-11-24):**
- `retryAfter` là tham số thứ sáu của constructor `AppError`, sau `details`, để không phải sửa nơi gọi nào. `enforcePendingOrderLimit` truyền `undefined` cho `details`.
- Route đặt trước chưa có test nào cho giới hạn đơn chờ. Đã thêm một test vào `test/preorders.test.ts`: email có 3 đơn chờ thì đặt trước thứ tư nhận 429, có `fields` `address.email` và `Retry-After`. Test này xanh cả trước lẫn sau khi đổi code.
- Đã chạy `pnpm --filter api test`: 84 file, 820 test xanh. Typecheck, ESLint và Prettier sạch.
