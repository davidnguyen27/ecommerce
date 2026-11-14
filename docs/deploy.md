# Triển khai bản demo

Bản demo chạy ở bốn nơi (ADR 0011). Mỗi lần push lên nhánh deploy, Netlify và Render tự build lại. Lần đầu thì chạy wizard `bash scripts/deploy-demo.sh`: nó mở từng trang, hỏi từng giá trị và ghi vào `.env.deploy` (file này không commit).

```
trình duyệt ──► Netlify: web Nuxt (SSR) ── /api/* proxy ──► Render: API (api/Dockerfile) ──► Neon: Postgres (direct)
                                                                     └──────────────────► Cloudflare R2: ảnh, chứng từ
cron-job.org ──► https://<api>.onrender.com/healthz mỗi 10 phút, để API không ngủ
```

## Biến môi trường

| Nơi     | Biến                                                        | Giá trị                                                                       |
| ------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Netlify | `NUXT_API_BASE`                                             | `https://<api>.onrender.com` (SSR gọi thẳng API)                              |
| Netlify | `NUXT_PUBLIC_SITE_URL`                                      | `https://<site>.netlify.app`                                                  |
| Render  | `DATABASE_URL`                                              | Connection string **direct** của Neon (không có `-pooler`), `sslmode=require` |
| Render  | `SITE_URL`                                                  | `https://<site>.netlify.app`                                                  |
| Render  | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`   | Endpoint S3 và API token của Cloudflare R2                                    |
| Render  | `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, `MEDIA_PUBLIC_URL` | Tên hai bucket; URL công khai `https://pub-….r2.dev` của bucket public        |
| Render  | `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`                       | Khóa sandbox VNPAY                                                            |

Các biến cố định nằm trong `render.yaml`:

- `JWT_SECRET`: Render tự sinh.
- `TRUST_PROXY=5`, `MAIL_PROVIDER=log`, `STORAGE_PROVIDER=r2`, `VNPAY_ENV=sandbox`, `PAYMENT_SIMULATOR=allow`.

Proxy `/api/*` khai trong `web/netlify.toml`. Nếu Render cấp URL khác `atelier-demo-api.onrender.com`, sửa dòng `to` trong file đó.

## Chủ shop và dữ liệu mẫu

Chạy từ máy, nhắm vào DB và site của bản deploy:

```sh
cd api
DATABASE_URL='<neon direct>' OWNER_EMAIL=... OWNER_PASSWORD='<≥12 ký tự>' OWNER_NAME='Chủ shop' pnpm seed:owner
cd ..
DEMO_SEED_BASE_URL=https://<site>.netlify.app OWNER_EMAIL=... OWNER_PASSWORD=... node scripts/demo-seed.ts
```

Mật khẩu demo ghi trong `scripts/demo-seed.ts` chỉ dùng cho máy local. Repo công khai, nên bản deploy phải có mật khẩu riêng.

## VNPAY sandbox

- **Trang quay về:** VNPAY đưa khách về `https://<site>.netlify.app/don-hang/<mã>?ket-qua=1`, URL này đi theo từng đơn nên không phải khai.
- **IPN:** khai `https://<api>.onrender.com/api/payments/vnpay/ipn` với VNPAY, nếu trang merchant sandbox có mục đó. Không khai thì trang quay về vẫn ghi nhận được (`docs/vnpay.md`).

## Vận hành

- **Xem log:** dashboard Render (API), Netlify → Functions (SSR). Email nằm trong log Render, vì `MAIL_PROVIDER=log`.
- **Deploy lại:** push lên nhánh deploy, hoặc bấm "Manual deploy" ở mỗi dashboard. Migration chạy mỗi lần API khởi động; nó không làm gì nếu không có migration mới.

## Giới hạn

- Render Free ngủ sau 15 phút nếu ping ngừng, mất khoảng 1 phút để bật lại. Trong lúc đó Netlify trả lỗi sau 26 giây, và job hủy đơn cũng như email bị dừng.
- Render có thể khởi động lại service bất kỳ lúc nào.
- Neon có 100 CU-giờ mỗi tháng. Netlify Free có 300 credit.
- Không dùng bản này để bán thật: thanh toán là sandbox. Bán thật thì theo kế hoạch VPS hoặc lên gói trả phí.
