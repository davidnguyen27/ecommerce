# 01: Chuyển ghi mã giảm giá vào `vouchers/voucher-admin.ts`

**What to build:**
- Tạo, sửa và tắt mã giảm giá thành hàm của module. Route `admin-vouchers.ts` chỉ còn phần HTTP.

**Blocked by:** —

**Status:** resolved

- [x] `vouchers/voucher-admin.ts` export `createVoucher(tx, audit, staffId, input)` (trả id), `updateVoucher(tx, audit, id, input)` và `disableVoucher(tx, audit, id)`.
- [x] `checkScope`, `normalize`, `columns` và `draftOf` chuyển theo, không export nếu route không cần.
- [x] Khóa dòng mã, các quy tắc sửa khi đã có lượt dùng, tổng lượt không thấp hơn số đã dùng, kiểm lại `VoucherDraft`: giữ nguyên. Không đổi gì thì không ghi audit, giữ nguyên.
- [x] Route còn parse, `requirePermission`, `audited(...)` gọi module, `loadVoucher` trả response. Các GET giữ nguyên.
- [x] `vouchers-admin.test.ts`, `checkout-voucher.test.ts` và cả bộ test api xanh mà không sửa.

Spec: mục "Solution".

**Quyết định khi triển khai (2026-11-25):**
- `vouchers/voucher-admin.ts` (208 dòng) export `createVoucher`, `updateVoucher` và `disableVoucher`; các helper không export. `updateVoucher` nhận input đã parse và tự `normalize`. Route giảm từ 291 còn 120 dòng.
- Input dùng kiểu đã parse (`z.output`); helper `normalize` trước đây khai kiểu `z.input`, nay sửa cho đúng.
- `pnpm --filter api test`: 84 file, 821 test xanh, không sửa test. Typecheck, ESLint, Prettier sạch.
