# 01: Lớp nền `core/` và generator

**What to build:**
- Lớp nền dùng chung và generator module, chưa chuyển miền nào.

**Blocked by:** —

**Status:** resolved

- [x] `core/`: `BaseModule`, `IRoute`, `BaseRepository` (mọi method nhận `db`), `BaseCrudService` (hook, transaction có audit, không đổi thì không ghi), `BaseCrudController`, `RequestContext` + `contextOf(req)`, middleware `validate(Schema, part)` + `dtoOf(res)`.
- [x] `audited(db, ctx, fn)` nhận `RequestContext`; các nơi gọi hiện có chuyển sang `audited(prisma, contextOf(req), fn)`. Hành vi không đổi.
- [x] Chuyển `http/`, `audit/`, `adapters/`, `jobs/`, `media/`, `db.ts` cùng phần dùng chung của `auth/` (`require-auth`, `staff-context`, `permissions`, `opaque-token`) vào `core/`; sửa import.
- [x] `modules/index.ts` với `createModules(deps)` (lúc này rỗng); `app.ts` gắn `module.routes`.
- [x] ESLint `no-restricted-imports`: chặn `modules/*/` import file bên trong module khác (chỉ cho `modules/<x>/index.ts`).
- [x] `plopfile.js` + `plop-templates/` sinh đủ bộ file của một module; script `gen:module` trong `api/package.json`.
- [x] Typecheck, lint, bộ test api (CI) và `pnpm smoke` xanh mà không sửa test.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.

**Quyết định khi triển khai (2026-11-28):**
- Vị trí trong `core/`: `db.ts`, `errors.ts`, `pagination.ts` ở gốc; `middleware/` có `rate-limit`, `validation` (thêm `validate`, `dtoOf`), `require-auth`, `staff-context`; `auth/` có `permissions`, `opaque-token`; `audit/`, `adapters/`, `jobs/`, `media/` giữ nguyên tên thư mục; thêm `context/`, `module/`, `repository/`, `service/`, `controller/`.
- Di chuyển bằng script (`git mv` rồi tính lại import tương đối ở `src/` và `test/`): 19 file đổi tên, 129 file chỉ sửa import. **Test có sửa, nhưng chỉ đường dẫn import** (21 file); không đổi nội dung kiểm. `scripts/chatbot-check.ts` sửa một import.
- `audited(prisma, contextOf(req), fn)`: 65 lời gọi trong 25 file đổi bằng script. `contextOf` đọc nhân viên, IP, user agent lúc gọi, như trước.
- `IRoute` có thêm `access: 'public' | 'customer' | 'staff'`; `app.ts` gắn module trước các router cũ và tự đặt đăng nhập theo `access` (`staff` thì dưới `/api/admin`, qua `requireAuth` + `loadStaff`).
- `BaseRepository` nhận `ModelDelegate` dạng cấu trúc; đã kiểm `db.category` gán được (Prisma 7). `lockById` dùng `$queryRawUnsafe` với tên bảng là hằng của class.
- `BaseCrudService.getItem(id, db = prisma)`: service có `db` mặc định; chỉ repository bắt buộc nhận `db`.
- ESLint `no-restricted-imports` (regex) cho `api/src/modules/**`, trừ `modules/index.ts`. Đã thử: import `../x/x.service.ts` bị chặn; `../x/index.ts` và `../../core/…` qua.
- Generator: `pnpm --filter @ecommerce/api gen:module` hỏi tên, đường dẫn, quyền, tiền tố audit, tên schema create/update trong shared. Module sinh thử (`brand`) typecheck, lint, Prettier sạch, rồi đã xóa.
- Hook pre-commit thêm `--max-arg-length 4000` cho lint-staged: commit di chuyển hơn 140 file vượt giới hạn dòng lệnh của Windows (commit riêng 6c57b62).
- Còn tạm: `core/jobs/jobs.ts` vẫn import hàm nghiệp vụ (`orders/cancel-order.ts`, `preorders/deadlines.ts`, `support/exchanges.ts`). Chuyển thành interface khi các module đó chuyển (ticket 03, 05, 07).
