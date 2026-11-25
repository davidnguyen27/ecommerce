# 02: Link thanh toán không nhận `req`

**What to build:**
- `createOrderPaymentLink` nhận đúng những gì nó dùng: cổng, địa chỉ website, IP khách và logger. Không nhận `req` của Express nữa.

**Blocked by:** —

**Status:** resolved

- [x] Chữ ký mới: `createOrderPaymentLink(tx, { payments, siteUrl, clientIp, log }, order, link)`.
- [x] Việc bỏ tiền tố IPv4-mapped (`::ffff:`) và mặc định `127.0.0.1` khi không có IP chỉ nằm ở một nơi. Ghi trong ticket chọn nơi nào.
- [x] Cổng lỗi vẫn log `{ err, orderCode }` với thông điệp cũ, rồi ném 502 như cũ.
- [x] Đổi theo ở hai route đặt mua và đặt trước, và ở `createRemainderLink` (`preorders/remainder.ts`). `createRemainderLink` vẫn nhận `req`/`res` cho `enforceRateLimits`.
- [x] `payment-links.test.ts`, `preorder-remainder.test.ts`, `checkout*.test.ts` và `preorder*.test.ts` xanh mà không sửa.

Spec: mục "Thay đổi ngoài module".

**Quyết định khi triển khai (2026-11-24):**
- Bỏ tiền tố `::ffff:` và mặc định `127.0.0.1` nằm trong `createOrderPaymentLink`. Nơi gọi truyền `req.ip` nguyên dạng (`clientIp: string | undefined`), nên không chỗ gọi nào phải tự chuẩn hóa.
- `createRemainderLink` giữ nguyên chữ ký (`req`, `res`), chỉ đổi lời gọi bên trong thành `{ ...deps, clientIp: deps.req.ip, log: deps.req.log }`.
- `pnpm --filter api test`: 84 file, 820 test xanh. Typecheck, ESLint và Prettier sạch.
