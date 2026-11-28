# 06: Nhóm đặt đơn và tiền

**What to build:**
- Đặt đơn, thanh toán, đối soát, hoàn tiền. Cổng thanh toán chuyển vào `core/adapters/payment/`; thay adapter tạm của ticket 03.

**Blocked by:** 02, 03

**Status:** resolved

- [x] Mỗi module (`checkout`, `payment`, `reconciliation`, `refund`) có đủ các lớp theo spec, mục "Cấu trúc thư mục"; module khác chỉ import qua `index.ts`.
- [x] Code cũ của nhóm này (route trong `routes/`, file trong thư mục miền cũ) bị xóa; `app.ts`/`modules/index.ts` gắn module mới.
- [x] Chuyển trạng thái nào cũng khóa dòng; audit trong transaction; thông điệp lỗi, `fields`, nội dung audit giữ nguyên từng chữ.
- [x] Typecheck, lint, bộ test api (CI) và `pnpm smoke` xanh mà không sửa test.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.

**Quyết định khi triển khai (2026-11-28):**
- Cổng thanh toán (`gateway.ts`, `vnpay.ts`, `gateway-from-env.ts`) chuyển vào `core/adapters/payment/` bằng git mv; 21 file chỉ đổi import (gồm test, chỉ đường dẫn).
- Cùng cách với ticket 05: file nghiệp vụ chuyển nguyên bằng git mv vào module (`payment/payment-record.ts`, `payment/payment-link.ts`, `refund/refund-record.ts`, `refund/refund-gateway.ts`, `reconciliation/reconciliation-actions.ts`, `checkout/*` từ `placement/*`), giữ thân hàm và truy vấn; lớp HTTP (route, controller, service, cùng repository và mapper cho danh sách đối soát) viết theo khuôn. **Chưa đưa hết truy vấn của các file đó vào repository**, lý do như ticket 05.
- `executeGatewayRefund` nhận `ctx` và `log` thay cho `req`.
- `index.ts` của `payment` và `refund` export các hàm ghi tiền và hoàn tiền mà đơn hàng, đặt trước, hỗ trợ, đối soát gọi trong transaction của chúng; file lá export trước, module sau cùng (tránh lỗi import vòng như ticket 05). Đã nạp app từ từng `index.ts` mà test dùng.
- Route cổng thanh toán: route VNPAY chỉ gắn khi có hash secret, route mô phỏng chỉ khi chạy bộ mô phỏng, như cũ. Mô phỏng hết hạn gọi `OrderModule.service.expire`.
- Hoàn tiền và đối soát trả chi tiết đơn qua `OrderModule.query.loadAdminOrder`, không tự dựng query nữa.
- Báo giá (`/checkout/quote`, `/preorders/quote`) chuyển vào `CheckoutService`; service còn nhận `req` cho riêng `quoteVoucher` (giới hạn tần suất theo IP) cho tới khi module `voucher` chuyển (ticket 07).
- Thư mục `payments/`, `placement/` không còn. Bộ test api (cần Docker) chạy trên CI.
