# Notes for implementer and merger subagents: spec m0-m1-nen-mong-danh-muc

Repo: D:\my_project\ecommerce. Integration branch: `spec/m0-m1-nen-mong-danh-muc` (checked out in the main repo dir; never commit there yourself unless you are the merger).

## Read first (context pointers, don't skip)
- Spec: `.scratch/m0-m1-nen-mong-danh-muc/spec.md`; your ticket: `.scratch/m0-m1-nen-mong-danh-muc/issues/NN-*.md` (also read the tickets it is blocked by, especially their "Quyết định" sections: they record API names and choices you build on).
- `CODING_STANDARDS.md` (binding; the code review checks it), `GLOSSARY.md`, `docs/adr/`.
- Reference implementation of a whole ticket, end to end (migration, shared zod schemas, admin + public routes, HTTP tests, admin SPA page, SSR customer page, smoke checks): `git show e3aa9f9` (ticket 07). Also `git show ffeee20` (ticket 04).

## Worktree setup
1. Confirm your branch contains the integration tip: `git merge-base --is-ancestor spec/m0-m1-nen-mong-danh-muc HEAD`; if not, `git reset --hard spec/m0-m1-nen-mong-danh-muc`.
2. `pnpm install --frozen-lockfile` (worktrees have no node_modules). Adding a dependency is allowed when the ticket needs it; commit the lockfile.
3. Docker is running; API tests use Testcontainers (`cd api && pnpm vitest run test/<file>`).

## How to build
- Call the Skill tool with `tdd`. The seam is pre-agreed for every ticket: HTTP tests via supertest on real Postgres (see CODING_STANDARDS "Test"), covering the cases the ticket lists. Do not ask the user to confirm seams; there is no user in the loop.
- Run `pnpm typecheck` and single test files regularly; `pnpm lint` and the full `pnpm test` once at the end.
- **Do NOT run `pnpm smoke`**: it uses fixed ports and a fixed compose project, so parallel runs collide. Only the merger runs it. Do update `scripts/smoke.ts` when customer-facing HTML changes (CODING_STANDARDS "Web").
- Prisma migrations: write the SQL by hand in the style of existing migrations, keep `schema.prisma` in sync. Name the folder `2026102500NN00_<slug>` where NN is your ticket number (e.g. ticket 09 → `20261025000900_...`), so name order follows the dependency order.
- No product owner is reachable. If a genuine product decision blocks you, pick the conservative option, implement it, and record it in the ticket as "Cần chủ doanh nghiệp xác nhận".
- Open item from ticket 07: hiding a category currently hides its whole subtree publicly (awaiting owner confirmation). Don't change it; don't make products depend on category/brand visibility (GLOSSARY "Ẩn").

## Closing the ticket (this is how the tracker closes work)
- In the ticket file: tick the checkboxes you satisfied, set `**Status:** resolved`, and append `**Quyết định khi triển khai (2026-10-23):**` bullets: API routes, names other tickets will use, permissions used or added, deviations, open items.
- Commit on your own branch with message `Ticket NN: <ticket title>` ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never skip hooks.
- Before reporting: `git merge spec/m0-m1-nen-mong-danh-muc` into your branch, resolve conflicts, rerun typecheck and the full API tests.
- Report back in under 150 words: branch name, head SHA, what was built, decisions needing owner confirmation, anything you couldn't finish.

## Merger
- Works in the main repo dir on `spec/m0-m1-nen-mong-danh-muc`. `git merge --no-ff <branch>`; resolve conflicts (schema.prisma, shared/src/index.ts, app.ts/admin.ts route lists, admin layout menu, smoke.ts are the usual spots; keep both sides).
- Then `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm smoke`. Fix integration breakage with a follow-up commit; if a fix needs real feature work, report it instead.
