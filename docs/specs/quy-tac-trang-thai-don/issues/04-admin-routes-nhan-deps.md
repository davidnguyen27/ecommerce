# 04: `adminRoutes` nhận `deps`

**What to build:**
- `adminRoutes` nhận một object như `checkoutRoutes(deps)` và các router khác, thay cho năm tham số theo vị trí.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] `routes/admin.ts`: `adminRoutes(deps: Pick<AppDeps, 'prisma' | 'storage' | 'payments' | 'emails' | 'siteUrl' | 'llm'>)`. Bên trong vẫn truyền tiếp cho các router con như hiện nay; không đổi chữ ký router con trong ticket này.
- [ ] `app.ts` gọi `adminRoutes(deps)`.
- [ ] Typecheck, lint, cả bộ test api xanh mà không sửa.

Spec: mục "Problem Statement" 4.
