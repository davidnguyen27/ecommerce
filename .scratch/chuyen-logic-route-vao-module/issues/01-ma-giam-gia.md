# 01: Chuyển ghi mã giảm giá vào `vouchers/voucher-admin.ts`

**What to build:**
- Tạo, sửa và tắt mã giảm giá thành hàm của module. Route `admin-vouchers.ts` chỉ còn phần HTTP.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] `vouchers/voucher-admin.ts` export `createVoucher(tx, audit, staffId, input)` (trả id), `updateVoucher(tx, audit, id, input)` và `disableVoucher(tx, audit, id)`.
- [ ] `checkScope`, `normalize`, `columns` và `draftOf` chuyển theo, không export nếu route không cần.
- [ ] Khóa dòng mã, các quy tắc sửa khi đã có lượt dùng, tổng lượt không thấp hơn số đã dùng, kiểm lại `VoucherDraft`: giữ nguyên. Không đổi gì thì không ghi audit, giữ nguyên.
- [ ] Route còn parse, `requirePermission`, `audited(...)` gọi module, `loadVoucher` trả response. Các GET giữ nguyên.
- [ ] `vouchers-admin.test.ts`, `checkout-voucher.test.ts` và cả bộ test api xanh mà không sửa.

Spec: mục "Solution".
