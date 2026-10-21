# 01: Khung chạy được end-to-end (walking skeleton)

**What to build:** Một lát cắt mỏng nhất chạy xuyên qua mọi tầng, để mọi ticket sau chỉ việc thêm vào. Lập trình viên chạy một lệnh Docker Compose là có Postgres, API Express, website Nuxt và Caddy chạy cùng một tên miền. Mở trình duyệt thấy một trang Nuxt hiển thị trạng thái lấy từ API. Chạy lệnh test thì bộ test HTTP (supertest + Postgres thật bằng Testcontainers) chạy xanh.

Đây là ticket prefactor: nó tạo sẵn các thứ dùng chung để các ticket sau không phải tự dựng lại:
- cấu trúc lỗi API thống nhất (mã lỗi, lỗi kiểm tra dữ liệu theo từng trường);
- log pino có request id;
- gói `shared` chứa schema Zod dùng chung cho API và Nuxt;
- cách inject các adapter (storage, mailer) qua cấu hình app để test thay bằng bản giả.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Monorepo pnpm có 3 phần api, web, shared; lint và typecheck chạy được ở gốc repo
- [x] Docker Compose ở local dựng Postgres (có bật `unaccent` và `pg_trgm`), API, Nuxt và Caddy; Nuxt và API chạy cùng tên miền (`/api/*` đi tới Express)
- [x] Prisma có migration đầu tiên bật hai extension trên
- [x] `/healthz` trả 200 khi kết nối được DB và trả lỗi khi mất kết nối DB
- [x] Một trang Nuxt (SSR) gọi API và hiển thị kết quả
- [x] Request sai schema trả về đúng cấu trúc lỗi thống nhất, có lỗi theo từng trường
- [x] Mỗi request có request id xuất hiện trong log JSON và trong response header
- [x] Bộ test chạy app in-process trên Postgres thật bằng Testcontainers, mỗi test có DB sạch; có ít nhất một test cho `/healthz` và một test cho lỗi kiểm tra dữ liệu
- [x] Code có điểm inject adapter qua cấu hình app, sẵn sàng cho storage và mailer giả

## Comments

**2026-10-21:** Hoàn thành ở commit `296a169`. Đã kiểm tra bằng chạy thật:
- `pnpm lint`, `pnpm typecheck`, `pnpm test` ở gốc repo đều xanh (10 test, Postgres 17 qua Testcontainers, mỗi test một DB clone từ template).
- `docker compose up --build`: migration bật `unaccent` và `pg_trgm`; qua Caddy ở `http://localhost`, `/healthz` trả 200, trang chủ Nuxt (SSR) hiển thị trạng thái lấy từ API; dừng Postgres thì `/healthz` trả 503 `SERVICE_UNAVAILABLE`.
- Test lỗi kiểm tra dữ liệu đang dùng endpoint thử gắn qua `createApp(deps, extraRoutes)`; khi có endpoint thật nhận dữ liệu vào (ticket 02/05) thì chuyển test sang đó và bỏ tham số này.
