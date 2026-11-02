# 13: CI trên GitHub Actions

**What to build:**
- Mỗi lần push và mỗi PR lên GitHub tự chạy lint, typecheck, test API và smoke trên runner Linux.
- Phần CI được tách khỏi ticket 15 của M0–M1. Phần build image, deploy và VPS vẫn ở ticket đó, chờ khi có domain và VPS.

**Blocked by:** —

**Status:** resolved

- [x] `.github/workflows/ci.yml` chạy khi push và pull_request; dùng pnpm có cache, Node theo phiên bản repo đã khai (`engines` hoặc `.nvmrc`)
- [x] Các job: lint, typecheck, test API, `pnpm smoke`. Testcontainers chạy được trên runner ubuntu vì runner đã có sẵn Docker
- [x] Không bật retry để che lỗi. Theo ghi chú ở ticket 15 của M0–M1, CI Linux là chuẩn để đánh giá test chập chờn trên Docker Desktop
- [x] Không cần secret: workflow dùng giá trị test, cổng thanh toán là cổng giả lập
- [x] Ghi vào ticket 15 của M0–M1 rằng phần CI đã chuyển sang ticket này
- [ ] Kiểm tra workflow hợp lệ (bằng `actionlint` nếu chạy được). Muốn chạy thật trên GitHub thì phải push nhánh: báo người dùng để họ push và xem kết quả

**Ghi chú:** `knip` (ghi ở retro) để sau, không thuộc ticket này.

**Quyết định khi triển khai (2026-11-02):**
- Workflow `.github/workflows/ci.yml`, tên `CI`, chạy khi `push` (mọi nhánh) và `pull_request`. Bốn job song song trên `ubuntu-latest`: `lint` (`pnpm lint`), `typecheck` (`pnpm typecheck`), `test-api` (`pnpm --filter @ecommerce/api test`, Testcontainers dùng Docker của runner), `smoke` (`pnpm smoke`). `permissions: contents: read`; `concurrency` hủy lượt cũ cùng ref và cùng loại sự kiện.
- Phiên bản Node khai ở `.nvmrc` mới thêm (`24`, khớp `node:24-slim` trong Dockerfile); setup-node đọc `node-version-file: .nvmrc`. pnpm lấy từ `packageManager` qua `pnpm/action-setup@v4`; cache store pnpm qua `actions/setup-node` (`cache: pnpm`).
- Job `smoke` không chạy `pnpm install` và không cache: `scripts/smoke.ts` chỉ dùng module có sẵn của Node, image api/web build trong `docker compose`. Smoke tự sinh `JWT_SECRET`, email ở chế độ log, file trong bộ nhớ, nên không cần secret. Ticket nào thêm biến môi trường bắt buộc cho api (ví dụ cổng thanh toán) phải để mặc định trong `docker-compose.yml` là cổng giả lập, nếu không smoke trên CI sẽ đỏ.
- Không có retry ở bất kỳ bước nào.
- Chưa kiểm bằng `actionlint`: chạy binary tải về bị chặn trên máy này và Docker Desktop đang tắt. Đã đọc kỹ workflow, `prettier --check` đạt. Mục checkbox cuối chưa tick: người dùng cần push nhánh để xem lượt chạy thật trên GitHub.
