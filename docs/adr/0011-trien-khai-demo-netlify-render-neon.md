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

- `req.ip` là IP khách và được dùng cho rate limit, audit và `vnp_IpAddr`. Trước API có năm tầng proxy tính cả kết nối trực tiếp (hai tầng của Netlify, Cloudflare mà Render đặt phía trước, rồi mạng nội bộ của Render), nên `TRUST_PROXY=5`. Số này đo bằng IP trong audit ở mục Kết quả thử thật, và đổi nếu Netlify hay Render đổi hạ tầng. Đặt sai số tầng thì mọi khách chung một IP và rate limit chặn cả shop.

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

Deploy lần đầu 2026-11-13/14 (web `atelierde.netlify.app`, API `atelier-demo-api.onrender.com`), kiểm bằng curl, truy
vấn chỉ đọc vào Neon và thử tay trên trình duyệt:

- **Proxy `/api/*` và cache:** qua Netlify trả 200, khoảng 0,5 giây khi API thức. Có `Cache-Control: no-store`, và
  `Cache-Status: "Netlify Edge"; fwd=miss`: CDN không giữ response.
- **Đăng nhập qua proxy:** `demo-seed` đăng nhập và ghi hơn 170 thao tác admin qua URL Netlify; người dùng đăng nhập
  admin trên trình duyệt được.
- **pg-boss trên Neon direct:** job `expire-overdue-orders` chạy định kỳ (193 lần hoàn tất), `send-email` hoàn tất, job
  `expire-order` của đơn được xếp lịch.
- **Ảnh R2:** URL `pub-….r2.dev` trả 200 `image/png`; trang sản phẩm hiện ảnh.
- **VNPAY sandbox:** người dùng trả bằng thẻ test NCB. Đơn sang `processing` với giao dịch nguồn `return`; chưa khai IPN
  nên không có giao dịch nguồn `webhook`.
- **IP khách: SAI.** Audit ghi IP `172.68.x.x` / `172.70.x.x`, là IP của Cloudflare, không phải IP người dùng. Render đặt
  Cloudflare trước load balancer của mình, nên giữa khách và API có hơn hai tầng proxy, và `TRUST_PROXY=2` không đủ.
  Hệ quả: rate limit có thể gộp nhiều khách chung một IP, audit và `vnp_IpAddr` không đúng IP khách. Log request của
  Render cho `x-forwarded-for: <khách>, <Cloudflare 162.158.x>, <10.24.x nội bộ>` với request gọi thẳng Render. Đặt thử
  `TRUST_PROXY=3` thì audit ghi `47.130.x.x` (AWS Singapore, tức Netlify); đặt `4` thì ghi `100.64.x.x` (mạng nội bộ
  của Netlify). Chuỗi qua Netlify là `<khách>, <100.64.x>, <47.130.x>, <Cloudflare>, <10.x>`, nên đặt
  `TRUST_PROXY=5`. Đếm tầng phụ thuộc hạ tầng của hai bên; nếu audit lại ra IP lạ thì đo lại. Express đếm cả kết nối trực tiếp; địa chỉ giả do khách tự chèn nằm bên trái nên không ảnh
  hưởng. Request gọi thẳng Render (cron ping, IPN VNPAY) có ít tầng hơn nên `req.ip` của chúng không đáng tin:
  ai gọi thẳng `onrender.com` kèm `x-forwarded-for` tự chế thì chọn được IP mà API thấy, nên lách được rate limit. Chấp
  nhận cho bản demo; bán thật thì quay về VPS sau Caddy, nơi API chỉ nhận kết nối từ proxy.

Lỗi gặp khi deploy, đã sửa:

- Render chạy `dockerCommand: sh -c "…"` thành một tên lệnh (`not found`, exit 127): đổi sang lệnh đơn
  `pnpm start:migrate`. Service tạo từ Blueprint giữ lệnh cũ trong Settings, phải sửa tay.
- Ô nhập ẩn của wizard khiến khóa bị dán nhiều lần: wizard kiểm dạng khóa và cho chạy tiếp từ một stage.
- Site Netlify mới bật sẵn bảo vệ đăng nhập (401 cho mọi đường dẫn): tắt ở Visitor access.
- `NUXT_API_BASE` chưa có hiệu lực ở Functions nên SSR gọi `localhost:3001` (502 ở trang sản phẩm, trang chủ trống):
  biến phải có scope Functions, rồi deploy lại.
