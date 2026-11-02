# 12: Cổng PayOS thật (khung, chưa có khóa)

**What to build:**
- Bản cài đặt PayOS cho interface cổng thanh toán, chạy được ngay khi có khóa. Chưa cần tài khoản PayOS: khóa để trống trong `.env.example`.
- API chọn cổng theo biến môi trường; ở production, thiếu khóa thì API không khởi động.

**Blocked by:** 05 (Ghi nhận thanh toán)

**Status:** ready-for-agent

- [ ] Biến môi trường `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` có trong config (Zod) và trong `.env.example`. Trong `.env.example` để trống, kèm comment nói lấy khóa ở đâu
- [ ] Adapter PayOS có ba thao tác:
  - tạo link: `POST /v2/payment-requests`, `orderCode` là mã đơn, `expiredAt` là Unix timestamp, request có chữ ký;
  - truy vấn: `GET /v2/payment-requests/{id}`, ánh xạ các trạng thái `PENDING`, `PAID`, `UNDERPAID`, `CANCELLED`, `EXPIRED`, `PROCESSING`, `FAILED` và lấy danh sách giao dịch;
  - hủy link.

  Dùng SDK chính thức nếu đáng tin, không thì dùng `fetch`. Ghi lý do chọn vào quyết định.
- [ ] Chọn cổng: đủ ba khóa thì dùng PayOS; thiếu khóa thì dùng cổng giả lập; `NODE_ENV=production` mà thiếu khóa thì API dừng khởi động với thông báo rõ
- [ ] Có test cho adapter với HTTP giả, không gọi PayOS thật:
  - request đúng định dạng và đúng chữ ký;
  - ánh xạ trạng thái đúng;
  - lỗi mạng hoặc lỗi từ PayOS thành lỗi cổng, để checkout trả 502.
- [ ] Có test: ở production, thiếu khóa thì khởi động thất bại
- [ ] Tài liệu ngắn trong `docs/` hoặc README về cách điền khóa, chạy tunnel và xác nhận URL webhook (chuẩn bị cho ticket 16)
