# 08: Nhóm tài khoản, nhân viên, audit

**What to build:**
- Đăng nhập nhân viên và khách, tài khoản khách, quản lý nhân viên, xem audit. Giới hạn tần suất đăng nhập, quên mật khẩu, đăng ký giữ nguyên.

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] Mỗi module (`auth`, `staff`, `customer-auth`, `customer`, `audit-log`) có đủ các lớp theo spec, mục "Cấu trúc thư mục"; module khác chỉ import qua `index.ts`.
- [ ] Code cũ của nhóm này (route trong `routes/`, file trong thư mục miền cũ) bị xóa; `app.ts`/`modules/index.ts` gắn module mới.
- [ ] Chuyển trạng thái nào cũng khóa dòng; audit trong transaction; thông điệp lỗi, `fields`, nội dung audit giữ nguyên từng chữ.
- [ ] Typecheck, lint, bộ test api (CI) và `pnpm smoke` xanh mà không sửa test.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.
