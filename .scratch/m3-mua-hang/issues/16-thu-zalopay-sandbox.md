# 16: Thử ZaloPay sandbox

**What to build:**
- Chạy website trên máy với khóa app sandbox của ZaloPay và thanh toán thử trên sandbox (không có tiền thật), đi hết cả hai đường ghi nhận (callback và truy vấn `refresh=1`), rồi kiểm các điểm ticket 17 chưa xác minh được từ tài liệu.

M3 chỉ xong khi ticket này xong. Thử bằng tiền thật không thuộc M3 (người dùng chốt 2026-11-09): ghi ở Further Notes của spec, làm trước khi mở bán.

**Blocked by:** 17 (Đổi cổng thanh toán sang ZaloPay)

**Status:** ready-for-human

Hướng dẫn: `docs/zalopay.md`.

- [ ] Có app sandbox ở `https://sbmc.zalopay.vn`; điền `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2` vào `.env` local (không commit), giữ `ZALOPAY_ENV=sandbox` và `PAYMENT_SIMULATOR=allow`
- [ ] Chạy tunnel tới website local, đặt `ZALOPAY_CALLBACK_URL=https://<tunnel>/api/payments/zalopay/callback`, `docker compose up`; log API ghi `payments: ZaloPayPaymentGateway`
- [ ] Đặt một đơn số tiền nhỏ, trả trên trang sandbox (app ZaloPay sandbox hay thẻ thử). Kết quả mong đợi: đơn thành đã trả đủ, có email, giao dịch có nguồn `webhook`
- [ ] Đặt thêm một đơn, trả trong lúc tunnel tắt, rồi quay về trang kết quả. Kết quả mong đợi: đơn được ghi nhận qua `refresh=1`, giao dịch nguồn `query`
- [ ] Kiểm các điểm chưa xác minh (ticket 17), sửa `api/src/payments/zalopay.ts` nếu khác:
  - request gửi dạng form-urlencoded có được không (repo mẫu gửi query string với body rỗng);
  - response truy vấn khi đã trả có `zp_trans_id`, `amount`, `server_time` không (thiếu `server_time` thì code lấy giờ truy vấn);
  - `amount` của callback có tính `discount_amount`/`user_fee_amount` không;
  - callback có đến cho đơn đã hết hạn không; trả sau khi `expire_duration_seconds` qua có được không.
- [ ] Ghi kết quả và các bất ngờ (nếu có) vào ticket này
