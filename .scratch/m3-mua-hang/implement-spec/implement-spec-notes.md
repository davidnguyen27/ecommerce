# Notes for implementer and merger subagents: spec m3-mua-hang

Repo: D:\my_project\ecommerce. Integration branch: `spec/m3-mua-hang` (checked out in the main repo dir; never commit there yourself unless you are the merger).

## Read first (context pointers, don't skip)
- Spec: `.scratch/m3-mua-hang/spec.md`; your ticket: `.scratch/m3-mua-hang/issues/NN-*.md`. Also read the tickets it is blocked by, especially their "Quyết định khi triển khai" sections: they record API names, table names and choices you build on.
- `CODING_STANDARDS.md` (binding; the code review checks it), `GLOSSARY.md` (section "Mua hàng", "Giữ hàng", "Xuất bán"), `docs/adr/0007-*`, `docs/adr/0008-*`, and the other ADRs.
- Reference implementations, end to end (migration, shared zod schemas, admin + public routes, HTTP tests, admin SPA page, smoke checks):
  - `git show 382ecf8` (M2 ticket 01: stock ledger, `changeStock` locking, append-only trigger);
  - `git show dda6c3b` (M2 ticket 02: stock receipts);
  - `git show 83c755e` (post-review cleanup: `conflictField`, `pageWindow`, `PageQuery`/`pageOf`, `ACTOR_SELECT`, job `delete-expired` + `api/test/cleanup.test.ts` as the pattern for testing jobs, `tokenSession`, `dates.ts`, `adminMenu.ts`).
  - Customer-side token/rate-limit patterns: `api/test/customer-auth.test.ts`, `api/test/rate-limit.test.ts`; injection of `Storage`/`EmailQueue` into `createApp` and `createTestApp` (`api/test/support/test-app.ts`) is the pattern for the payment gateway.

## Worktree setup
1. Confirm your branch contains the integration tip: `git merge-base --is-ancestor spec/m3-mua-hang HEAD`; if not, `git reset --hard spec/m3-mua-hang`.
2. `pnpm install --frozen-lockfile` (worktrees have no node_modules). Adding a dependency is allowed when the ticket needs it; commit the lockfile.
3. Docker Desktop must be running; API tests use Testcontainers (`cd api && pnpm vitest run test/<file>`). On Windows, a rare `Connection terminated due to connection timeout` is a known Docker Desktop port-forwarding hiccup (see `.scratch/m0-m1-nen-mong-danh-muc/implement-spec/progress.md`): rerun that file once; don't "fix" it in code. Any other failure is real.

## How to build
- Call the Skill tool with `tdd`. The seams are pre-agreed in the spec's "Testing Decisions" (HTTP via supertest on real Postgres; in-memory payment gateway; job functions called directly with a future `now`). Do not ask the user to confirm seams; there is no user in the loop.
- Run `pnpm typecheck` and single test files regularly; `pnpm lint` and the full `pnpm test` once at the end.
- **Do NOT run `pnpm smoke`**: it uses fixed ports and a fixed compose project, so parallel runs collide. Only the merger runs it. Do update `scripts/smoke.ts` when customer-facing HTML changes (CODING_STANDARDS "Web").
- Prisma migrations: SQL written by hand in the style of existing migrations, keep `schema.prisma` in sync. Name the folder `2026110200NN00_<slug>` where NN is your ticket number (ticket 03 → `20261102000300_...`), so name order follows the dependency order.
- Customer pages: Tailwind (`web/app/assets/css/tailwind.css`), match existing customer pages. Admin pages: `admin.css` classes inside `.admin-shell`, match existing admin pages; menu entries and permissions via `web/app/utils/adminMenu.ts`. Every form control needs a label (eslint `vuejs-accessibility` enforces it).
- No product owner is reachable. If a genuine product decision blocks you, pick the conservative option, implement it, and record it in the ticket as "Cần chủ doanh nghiệp xác nhận".
- Email copy you write is a draft for the owner; keep it short, Vietnamese, no claims about authenticity/origin (ADR 0005, `scripts/smoke.ts` `UNFOUNDED_CLAIMS`).

## Closing the ticket (this is how the tracker closes work)
- In the ticket file: tick the checkboxes you satisfied, set `**Status:** resolved`, and append `**Quyết định khi triển khai (2026-11-02):**` bullets: API routes, names other tickets will use (tables, functions, components), permissions used or added, deviations, open items.
- Commit on your own branch with message `Ticket NN: <ticket title>` ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never skip hooks.
- Before reporting: `git merge spec/m3-mua-hang` into your branch, resolve conflicts, rerun typecheck and the full API tests.
- Report back in under 150 words: branch name, head SHA, what was built, decisions needing owner confirmation, anything you couldn't finish.

## Merger
- Works in the main repo dir on `spec/m3-mua-hang`. `git merge --no-ff <branch>`; resolve conflicts (schema.prisma, shared/src/index.ts, app.ts/admin.ts route lists, adminMenu.ts, smoke.ts, test-app.ts are the usual spots; keep both sides).
- Then `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm smoke`. Fix integration breakage with a follow-up commit; if a fix needs real feature work, report it instead.
- Report back in under 100 words: merge SHA, check results.
