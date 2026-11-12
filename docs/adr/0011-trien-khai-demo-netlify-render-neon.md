# Bản demo chạy trên Netlify, Render, Neon và R2 thay cho VPS

Người dùng muốn đưa dự án lên mạng qua Netlify để học và demo, chưa có tên miền (2026-11-12). Netlify chỉ chạy web tĩnh và hàm serverless, nên các phần được chia như sau:

- **Web Nuxt** chạy trên Netlify.
- **API Express** chạy container trên Render gói Free.
- **Postgres** trên Neon gói Free.
- **Ảnh và chứng từ** trên Cloudflare R2.

Lý do API không chạy được trên Netlify: nó cần một tiến trình chạy liên tục, vì `pg-boss` hủy đơn hết hạn, gửi email và dùng LISTEN/NOTIFY.

Netlify proxy `/api/*` sang Render với status 200, nên trình duyệt vẫn thấy web và API cùng một origin. Nhờ vậy cookie refresh (host-only, `SameSite=Strict`) và các lệnh `$fetch('/api/...')` tương đối chạy như sau Caddy: không cần CORS, không sửa code web. Kế hoạch VPS chạy Docker Compose sau Caddy (spec M0–M1) vẫn là đích khi bán thật.

## Considered Options

- **Giữ VPS:** ít sửa nhất, nhưng người dùng chọn Netlify.
- **Dồn hết lên Netlify:** phải viết lại API thành Netlify Functions và thay `pg-boss` bằng scheduled functions. Sửa quá lớn.
- **Gọi API khác origin, không qua proxy:** cần CORS, cookie `SameSite=None` và sửa web.

## Consequences

**Proxy và CDN**

- Netlify chờ API tối đa **26 giây**. Render Free ngủ sau 15 phút không có truy cập và mất khoảng 1 phút để bật lại, nên phải có một dịch vụ ping `/healthz` mỗi 10 phút (người dùng chọn cron-job.org).
- CDN của Netlify có thể cache response có ETag. Vì vậy API mặc định trả `Cache-Control: no-store` cho mọi route `/api`; route nào muốn cache thì tự đặt lại.

**IP khách**

- `req.ip` là IP khách và được dùng cho rate limit, audit và `vnp_IpAddr`. Trước API có hai tầng proxy (Netlify, rồi load balancer của Render), nên `TRUST_PROXY=2`. Đặt sai số tầng thì mọi khách chung một IP và rate limit chặn cả shop.

**Database**

- Dùng connection string **direct** của Neon, vì LISTEN/NOTIFY không chạy qua pooler (PgBouncer ở chế độ transaction).
- Migration chạy ngay trong lệnh khởi động container, vì gói Free không có pre-deploy command.

**Thanh toán**

- Image API chạy `NODE_ENV=production`, mà khóa VNPAY sandbox ở production cần `PAYMENT_SIMULATOR=allow`. Có khóa VNPAY nên cổng giả lập không mở. Bản demo không nhận tiền thật.

**Bảo mật**

- Mật khẩu chủ shop demo trong `scripts/demo-seed.ts` không dùng cho bản deploy: chủ shop được tạo bằng `seed:owner` với mật khẩu riêng.

**Giới hạn của gói Free**

- Render có thể khởi động lại service bất kỳ lúc nào; job đang chạy dở sẽ được `pg-boss` chạy lại.
- Neon có 100 CU-giờ mỗi tháng.
- Netlify Free có 300 credit, và chưa rõ có được dùng cho mục đích thương mại.
- Bán thật thì quay về kế hoạch VPS, hoặc lên gói trả phí.

## Kết quả thử thật

(Ghi khi deploy lần đầu, theo `docs/agents/third-party.md`.) Cần kiểm:

- `Set-Cookie` có qua proxy không;
- header IP khách và giá trị `TRUST_PROXY`;
- `no-store` có chặn được CDN cache không;
- `pg-boss` có chạy trên Neon direct không;
- ảnh trên R2;
- trọn luồng VNPAY sandbox.
