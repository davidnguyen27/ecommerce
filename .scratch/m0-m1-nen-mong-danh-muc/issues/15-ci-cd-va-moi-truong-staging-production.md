# 15: CI/CD và môi trường staging/production

**What to build:**
- Mỗi lần đẩy code lên GitHub, CI tự chạy lint, typecheck và test.
- Nhánh chính được build thành image, đẩy lên GHCR và tự deploy lên staging. Production được deploy khi người vận hành chủ động kích hoạt.
- Staging và production chạy chung một VPS nhưng tách DB, tách bucket và tách secret. Migration Prisma chạy thành một bước riêng trước khi app khởi động.

Ticket này cần người làm: tạo repo GitHub, có VPS, có tài khoản Cloudflare và Sentry. Người vận hành chạy wizard `bash scripts/setup-infra.sh` trước để tạo đủ repo, environment, secret và biến. Agent viết workflow và cấu hình server **dùng đúng các tên đã ghi ở đầu script đó**.

**Blocked by:** 01 (Khung chạy được end-to-end)

**Status:** ready-for-human

- [ ] Người vận hành đã chạy xong wizard: có repo GitHub, có 2 environment `staging` và `production`, phần tổng kết của wizard không còn mục nào phải làm tay
- [ ] Workflow CI chạy lint, typecheck và test (Testcontainers) cho mọi push và PR
- [ ] Nhánh chính được build image cho api và web, đẩy lên GHCR, rồi deploy staging qua SSH + `docker compose pull`. Deploy production kích hoạt bằng tay và dùng environment `production`
- [ ] Khi deploy, file `.env` trên VPS được dựng từ secret và biến của environment tương ứng; không lưu secret trong repo
- [ ] Migration Prisma chạy thành một bước riêng trước khi khởi động app; migration lỗi thì dừng deploy
- [ ] Caddy phục vụ cả 2 tên miền có HTTPS. Staging và production dùng DB riêng và bucket riêng
- [ ] Sau khi deploy, `/healthz` của cả hai môi trường trả 200
- [ ] Có tài liệu ngắn về cách deploy và cách rollback (chạy lại với tag image trước)
