# 16: Thử PayOS thật

**What to build:**
- Kết nối tài khoản PayOS thật của doanh nghiệp và thử chuyển khoản số tiền nhỏ, đi hết cả hai đường ghi nhận (webhook và truy vấn).

M3 chỉ xong khi ticket này xong. Đây là tiêu chí (b): đủ các ticket agent làm, test và E2E xanh, cộng thêm đã thử chuyển khoản thật.

**Blocked by:** 12 (Cổng PayOS thật)

**Status:** ready-for-human

- [ ] Có tài khoản PayOS của doanh nghiệp: đã xác thực CCCD và liên kết tài khoản ngân hàng nhận tiền
- [ ] Điền `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` vào `.env` local (không commit)
- [ ] Chạy tunnel tới API local, rồi xác nhận URL webhook `/api/payments/payos/webhook` trên dashboard PayOS
- [ ] Đặt một đơn số tiền nhỏ và chuyển khoản qua VietQR. Kết quả mong đợi: đơn thành đã trả đủ, có email, giao dịch có nguồn `webhook`
- [ ] Đặt thêm một đơn, chuyển khoản trong lúc tunnel tắt, rồi quay về trang kết quả. Kết quả mong đợi: đơn được ghi nhận qua `refresh=1`
- [ ] Ghi kết quả và các bất ngờ (nếu có) vào ticket này
