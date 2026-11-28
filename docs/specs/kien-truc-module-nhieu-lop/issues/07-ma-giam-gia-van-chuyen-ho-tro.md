# 07: Nhóm mã giảm giá, phí vận chuyển, hỗ trợ

**What to build:**
- Các module còn lại phía bán hàng và sau bán.

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] Mỗi module (`voucher`, `shipping-fee`, `support`, `return-window`) có đủ các lớp theo spec, mục "Cấu trúc thư mục"; module khác chỉ import qua `index.ts`.
- [ ] Code cũ của nhóm này (route trong `routes/`, file trong thư mục miền cũ) bị xóa; `app.ts`/`modules/index.ts` gắn module mới.
- [ ] Chuyển trạng thái nào cũng khóa dòng; audit trong transaction; thông điệp lỗi, `fields`, nội dung audit giữ nguyên từng chữ.
- [ ] Typecheck, lint, bộ test api (CI) và `pnpm smoke` xanh mà không sửa test.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.
