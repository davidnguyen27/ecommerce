# 07: Nhóm mã giảm giá, phí vận chuyển, hỗ trợ

**What to build:**
- Các module còn lại phía bán hàng và sau bán.

**Blocked by:** 02, 03

**Status:** resolved

- [x] Mỗi module (`voucher`, `shipping-fee`, `support`, `return-window`) có đủ các lớp theo spec, mục "Cấu trúc thư mục"; module khác chỉ import qua `index.ts`.
- [x] Code cũ của nhóm này (route trong `routes/`, file trong thư mục miền cũ) bị xóa; `app.ts`/`modules/index.ts` gắn module mới.
- [x] Chuyển trạng thái nào cũng khóa dòng; audit trong transaction; thông điệp lỗi, `fields`, nội dung audit giữ nguyên từng chữ.
- [x] Typecheck, lint, bộ test api (CI) và `pnpm smoke` xanh mà không sửa test.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.

**Quyết định khi triển khai (2026-11-28):**
- Cùng cách với ticket 05, 06: file nghiệp vụ chuyển nguyên bằng git mv (`vouchers/*` thành `voucher/voucher.{apply,discount,admin,query}.ts`, `shipping/shipping-fees.ts` thành `shipping-fee/shipping-fee.query.ts`, `support/*` thành `support/support-{request,return,exchange,warranty,email}.ts`); lớp HTTP viết theo khuôn. **Chưa đưa hết truy vấn của các file nghiệp vụ hỗ trợ vào repository.**
- `toVoucher` và `VOUCHER_INCLUDE` tách sang `voucher.mapper.ts`; `loadVoucher` thành `VoucherService.get`.
- `quoteVoucher` nhận IP thay cho `req`; `CheckoutService` không còn nhận `req`.
- `return-window` viết lại đủ lớp (trước nằm trong `support/returns.ts`). Lưu hạn đổi trả nay khóa advisory như phí giao, để `before` trong audit đúng với bản bị thay. `returnWindowSnapshot` vẫn ở module hỗ trợ.
- Hỗ trợ phía khách: ba đường (tài khoản, link tra cứu đơn, token liên hệ) dùng chung một route và controller, khác nhau ở `SupportViewer`. Phạm vi vẫn được kiểm trước mã yêu cầu như cũ.
- `storeSupportImage`, `deleteSupportImageQuietly` nhận file và logger thay cho `req`.
- Test chỉ đổi đường dẫn import (3 file). Bộ test api (cần Docker) chạy trên CI.
