# 01: `Retry-After` đi theo `AppError`

**What to build:**
- Lỗi 429 mang số giây chờ trong chính `AppError`, và `errorHandler` đặt header `Retry-After` từ đó. `enforcePendingOrderLimit` không cần `res` của Express nữa. Đây là bước chuẩn bị để module đặt đơn (ticket 04, 05) không nhận kiểu Express.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] `AppError` có thêm trường tùy chọn `retryAfter?: number` (giây). Các nơi tạo `AppError` hiện có không phải sửa.
- [ ] `errorHandler` đặt `Retry-After` khi lỗi có `retryAfter`. Response không có header này khi lỗi không mang giá trị đó.
- [ ] `enforcePendingOrderLimit(tx, contact, now?)` bỏ tham số `res` và ném 429 kèm `retryAfter`. Thông điệp, `fields` và cách tính số giây giữ nguyên.
- [ ] Hai route đặt mua và đặt trước gọi theo chữ ký mới.
- [ ] `enforceRateLimits` giữ nguyên, vì nằm ngoài phạm vi spec.
- [ ] `checkout-guards.test.ts` và mọi test khác xanh mà không sửa. Nếu chưa có test nào giữ header `Retry-After` của giới hạn đơn chờ ở route đặt trước thì thêm một test HTTP.

Spec: mục "Thay đổi ngoài module".
