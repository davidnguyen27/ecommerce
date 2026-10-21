# 16: Giám sát và sao lưu

**What to build:**
- Lỗi ở API và website được gửi về Sentry, có source map và gắn đúng tên môi trường.
- Uptime Kuma kiểm `/healthz` của cả hai môi trường và báo khi có sự cố.
- Mỗi đêm Postgres production được dump, mã hóa bằng khóa age và đẩy lên bucket backup trên R2, giữ 30 ngày.
- Có tài liệu quy trình khôi phục, và quy trình đó đã được diễn tập thật một lần trên staging.

Ticket này cần người làm: Sentry và khóa age được tạo qua wizard `bash scripts/setup-infra.sh`. Riêng khóa bí mật age thì chỉ người vận hành giữ, nên bước khôi phục phải do người làm.

**Blocked by:** 15 (CI/CD và môi trường staging/production)

**Status:** ready-for-human

- [ ] Sentry đã cài cho API (Express) và web (Nuxt), dùng `SENTRY_DSN_API` và `SENTRY_DSN_WEB`. CI upload source map bằng `SENTRY_AUTH_TOKEN`. Lỗi thử ở staging hiện đúng project và đúng môi trường
- [ ] Uptime Kuma theo dõi `/healthz` của staging và production. Kuma chạy ở nơi khác VPS chính, hoặc ghi rõ lý do nếu chấp nhận chạy chung VPS
- [ ] Job hằng đêm chạy `pg_dump` cho production, mã hóa bằng `BACKUP_AGE_RECIPIENT`, đẩy lên `BACKUP_R2_BUCKET` bằng token backup riêng, và xóa các bản cũ hơn 30 ngày
- [ ] Job backup lỗi thì có cảnh báo, qua Sentry hoặc email cho owner
- [ ] Có tài liệu khôi phục: tải bản backup, giải mã bằng khóa bí mật age, restore vào một DB
- [ ] Đã diễn tập khôi phục một lần lên staging, ghi lại ngày làm và thời gian mất bao lâu
