# 16: Thử ZaloPay sandbox

**What to build:**
- Chạy website trên máy với khóa app sandbox của ZaloPay và thanh toán thử trên sandbox (không có tiền thật), đi hết cả hai đường ghi nhận (callback và truy vấn `refresh=1`), rồi kiểm các điểm ticket 17 chưa xác minh được từ tài liệu.

M3 chỉ xong khi ticket này xong. Thử bằng tiền thật không thuộc M3 (người dùng chốt 2026-11-09): ghi ở Further Notes của spec, làm trước khi mở bán.

**Blocked by:** 17 (Đổi cổng thanh toán sang ZaloPay)

**Status:** ready-for-human

Hướng dẫn: `docs/zalopay.md`.

- [x] Có app sandbox (dùng merchant dùng thử công khai `554` ở https://developer.zalopay.vn/start/); điền `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2` vào `.env` local (không commit), giữ `ZALOPAY_ENV=sandbox` và `PAYMENT_SIMULATOR=allow`
- [ ] Chạy tunnel tới website local, đặt `ZALOPAY_CALLBACK_URL=https://<tunnel>/api/payments/zalopay/callback`, `docker compose up`; log API ghi `payments: ZaloPayPaymentGateway`
- [ ] Đặt một đơn số tiền nhỏ, trả trên trang sandbox (app ZaloPay sandbox hay thẻ thử). Kết quả mong đợi: đơn thành đã trả đủ, có email, giao dịch có nguồn `webhook`
- [ ] Đặt thêm một đơn, trả trong lúc tunnel tắt, rồi quay về trang kết quả. Kết quả mong đợi: đơn được ghi nhận qua `refresh=1`, giao dịch nguồn `query`
- [ ] Kiểm các điểm chưa xác minh (ticket 17), sửa `api/src/payments/zalopay.ts` nếu khác:
  - request gửi dạng form-urlencoded có được không (repo mẫu gửi query string với body rỗng);
  - response truy vấn khi đã trả có `zp_trans_id`, `amount`, `server_time` không (thiếu `server_time` thì code lấy giờ truy vấn);
  - `amount` của callback có tính `discount_amount`/`user_fee_amount` không;
  - callback có đến cho đơn đã hết hạn không; trả sau khi `expire_duration_seconds` qua có được không.
- [ ] Ghi kết quả và các bất ngờ (nếu có) vào ticket này

## Kết quả thử (2026-11-10, agent)

- Gọi thẳng `ZaloPayPaymentGateway` với merchant `554`: `createLink` trả `order_url` (`qcgateway.zalopay.vn`) và `app_trans_id` dạng `261110_<mã>`; `getPayment` của đơn chưa trả ra `pending`. Như vậy request form-urlencoded và MAC tạo đơn, truy vấn đều đúng.
- Response truy vấn đơn chưa trả: `{"return_code":3,"sub_return_code":0,"is_processing":true,"amount":0,"zp_trans_id":0,"discount_amount":0}`, không có `server_time`.
- Bất ngờ 1: bộ khóa `2553` trong code mẫu tài liệu bị từ chối (`2/-402 Chữ ký không hợp lệ`); chỉ `554` chạy.
- Bất ngờ 3 (đã sửa): `app_trans_id` cũ là `yymmdd_<mã đơn>`, nên reset DB rồi đặt lại trong ngày (mã đơn đánh lại từ 100000) hay người khác dùng chung merchant `554` sẽ trùng mã, ZaloPay báo -68 và đặt mua lỗi 502. Nay thêm đoạn ngẫu nhiên: `yymmdd_<mã đơn>_<8 hex>`; đã thử trên sandbox hai lần cùng mã đơn 100000 trong ngày, cả hai tạo được.
- Bất ngờ 2: trang thanh toán của `554` chỉ hiện QR, không có thẻ, bất kể `bank_code`. Bước trả tiền cần người dùng quét bằng app ZaloPay sandbox trên điện thoại; agent không làm được, nên các ô trả tiền, callback, `amount` có tính phí/giảm giá không và đơn hết hạn còn chờ người dùng.
