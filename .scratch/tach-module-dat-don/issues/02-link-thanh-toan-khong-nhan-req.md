# 02: Link thanh toán không nhận `req`

**What to build:**
- `createOrderPaymentLink` nhận đúng những gì nó dùng: cổng, địa chỉ website, IP khách và logger. Không nhận `req` của Express nữa.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] Chữ ký mới: `createOrderPaymentLink(tx, { payments, siteUrl, clientIp, log }, order, link)`.
- [ ] Việc bỏ tiền tố IPv4-mapped (`::ffff:`) và mặc định `127.0.0.1` khi không có IP chỉ nằm ở một nơi. Ghi trong ticket chọn nơi nào.
- [ ] Cổng lỗi vẫn log `{ err, orderCode }` với thông điệp cũ, rồi ném 502 như cũ.
- [ ] Đổi theo ở hai route đặt mua và đặt trước, và ở `createRemainderLink` (`preorders/remainder.ts`). `createRemainderLink` vẫn nhận `req`/`res` cho `enforceRateLimits`.
- [ ] `payment-links.test.ts`, `preorder-remainder.test.ts`, `checkout*.test.ts` và `preorder*.test.ts` xanh mà không sửa.

Spec: mục "Thay đổi ngoài module".
