# Atelier: bán lẻ hàng hiệu nhập khẩu

Website bán giày dép, quần áo, đồng hồ, túi xách và nước hoa nhập khẩu, kèm trang quản trị cho nhân viên. Có bán hàng sẵn và đặt trước có cọc, thanh toán VNPAY (sandbox), mã giảm giá, hủy và hoàn tiền, đổi trả và bảo hành, báo cáo, và chatbot tư vấn dùng model miễn phí.

Bản demo: https://atelierde.netlify.app (web) và https://atelier-demo-api.onrender.com (API). Dữ liệu demo là hư cấu; thanh toán chạy sandbox, không có tiền thật.

## Cấu trúc

| Thư mục    | Nội dung                                                                             |
| ---------- | ------------------------------------------------------------------------------------ |
| `api/`     | API Express + Prisma (Postgres), job nền pg-boss. Test bằng vitest + Testcontainers. |
| `web/`     | Nuxt 3 + Tailwind: website khách và trang quản trị (`/admin`).                       |
| `shared/`  | Schema zod và kiểu dùng chung giữa API và web.                                       |
| `e2e/`     | Test Playwright chạy trên stack của `pnpm smoke --keep`.                             |
| `scripts/` | Smoke check, dữ liệu demo, kiểm chatbot, wizard deploy.                              |

## Cần cài

- Node.js 24 (`.nvmrc`) và pnpm 10 (`corepack enable`).
- Docker (Docker Desktop trên Windows và macOS): chạy stack local và test API.

## Chạy trên máy

```bash
pnpm install
cp .env.example .env
```

Trong `.env`:

- `JWT_SECRET`: chuỗi ngẫu nhiên từ 32 ký tự, ví dụ `openssl rand -base64 48`.
- Muốn xem được ảnh sản phẩm: bật S3 local theo chú thích `STORAGE_PROVIDER` trong `.env.example` (`COMPOSE_PROFILES=local` và các biến `R2_*`). Dữ liệu demo cần bước này.
- Thanh toán và chatbot: xem hai mục bên dưới. Để trống thì dùng cổng giả lập và chatbot tắt.

Dựng stack (Postgres, migration, API, web, Caddy) rồi nạp dữ liệu demo:

```bash
docker compose up -d --build
node scripts/demo-seed.ts
```

Mở http://localhost. Trang quản trị ở http://localhost/admin/login; `demo-seed` in tài khoản chủ shop khi chạy xong. Chủ shop tạo nhân viên kho, bán hàng, kế toán ở mục **Nhân sự & Vai trò**.

Trên Windows, nếu `docker compose up --build` báo `additional privileges requested`, chạy `BUILDX_BAKE_ENTITLEMENTS_FS=0 docker compose up -d --build`, hoặc chạy lệnh từ PowerShell.

Email không gửi thật ở local (`MAIL_PROVIDER=log`): nội dung email nằm trong `docker compose logs api`.

## Thanh toán

Không có khóa VNPAY thì API dùng cổng giả lập: trang `/thanh-toan-gia-lap` có nút "Giả lập đã thanh toán".

Để thử VNPAY sandbox, đặt `VNPAY_TMN_CODE` và `VNPAY_HASH_SECRET` trong `.env`. Cách lấy khóa và thẻ test (ngân hàng NCB) ở [docs/vnpay.md](docs/vnpay.md).

## Chatbot

Đặt `GROQ_API_KEY` (https://console.groq.com/keys) và tùy chọn `OPENROUTER_API_KEY` trong `.env`, rồi chủ shop bật chatbot ở mục **Chatbot** của trang quản trị. Chuỗi model và hạn mức gói miễn phí ghi ở [ADR 0017](docs/adr/0017-chatbot-dung-model-mien-phi-qua-chuoi-du-phong.md).

Kiểm chất lượng và số token sau khi đổi prompt hay model: `pnpm chatbot-check --api http://localhost`.

## Kiểm tra

| Lệnh                               | Việc                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`      | ESLint, TypeScript cho cả workspace                                           |
| `pnpm test`                        | Test API (cần Docker đang chạy) và test web                                   |
| `pnpm smoke`                       | Dựng stack riêng ở cổng 8081, seed qua API, đọc HTML thật; xong thì xóa stack |
| `pnpm smoke --keep` rồi `pnpm e2e` | Test trình duyệt trên stack smoke; máy có Edge thì đặt `E2E_CHANNEL=msedge`   |

CI (`.github/workflows/ci.yml`) chạy lint, typecheck, test API, smoke và E2E cho mọi PR. Trên Docker Desktop, test API thỉnh thoảng hỏng vì hết thời gian kết nối Postgres; chạy lại riêng file đó, CI trên Linux là chuẩn.

## Bản demo

Web trên Netlify, API trên Render, Postgres trên Neon, ảnh trên Cloudflare R2. Cách cấu hình, deploy và xem log ở [docs/deploy.md](docs/deploy.md) và [ADR 0011](docs/adr/0011-trien-khai-demo-netlify-render-neon.md).

Giới hạn của bản demo dùng gói miễn phí:

- Render không phải lúc nào cũng tự deploy sau khi merge; khi đó bấm **Manual Deploy** trong dashboard Render. Service ngủ sau 15 phút không có request, lần gọi đầu mất khoảng một phút.
- Netlify tạm dừng deploy production khi hết credit build của chu kỳ; site đang chạy vẫn hoạt động.
- Hoàn tiền tự động qua VNPAY không gọi được API sandbox từ Render (Singapore). Khoản hoàn nằm ở trạng thái "cổng đang xử lý"; kế toán đánh dấu thất bại rồi hoàn bằng chuyển khoản.

## Tài liệu

- [docs/project-overview.md](docs/project-overview.md): định hướng sản phẩm và nghiệp vụ.
- [GLOSSARY.md](GLOSSARY.md): thuật ngữ dùng trong code và tài liệu.
- [docs/adr/](docs/adr/): các quyết định kiến trúc.
- [CODING_STANDARDS.md](CODING_STANDARDS.md): quy ước viết code.
- `.scratch/<mốc>/`: spec và ticket của từng mốc M0 đến M8.
