# 01: Lớp nền `core/` và generator

**What to build:**
- Lớp nền dùng chung và generator module, chưa chuyển miền nào.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] `core/`: `BaseModule`, `IRoute`, `BaseRepository` (mọi method nhận `db`), `BaseCrudService` (hook, transaction có audit, không đổi thì không ghi), `BaseCrudController`, `RequestContext` + `contextOf(req)`, middleware `validate(Schema, part)` + `dtoOf(res)`.
- [ ] `audited(db, ctx, fn)` nhận `RequestContext`; các nơi gọi hiện có chuyển sang `audited(prisma, contextOf(req), fn)`. Hành vi không đổi.
- [ ] Chuyển `http/`, `audit/`, `adapters/`, `jobs/`, `media/`, `db.ts` cùng phần dùng chung của `auth/` (`require-auth`, `staff-context`, `permissions`, `opaque-token`) vào `core/`; sửa import.
- [ ] `modules/index.ts` với `createModules(deps)` (lúc này rỗng); `app.ts` gắn `module.routes`.
- [ ] ESLint `no-restricted-imports`: chặn `modules/*/` import file bên trong module khác (chỉ cho `modules/<x>/index.ts`).
- [ ] `plopfile.js` + `plop-templates/` sinh đủ bộ file của một module; script `gen:module` trong `api/package.json`.
- [ ] Typecheck, lint, bộ test api (CI) và `pnpm smoke` xanh mà không sửa test.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.
