# 16: Thử VNPAY sandbox

**What to build:**
- Chạy website trên máy với khóa sandbox VNPAY, thanh toán thử trên sandbox (không có tiền thật) bằng thẻ test, và đi hết đường ghi nhận qua `refresh=1` (`querydr`).
- IPN qua tunnel nếu khai được URL với VNPAY.
- Kiểm các điểm ticket 18 chưa xác minh được từ tài liệu.

M3 chỉ xong khi ticket này xong. Thử bằng tiền thật không thuộc M3: ghi ở Further Notes của spec, làm trước khi mở bán.

Đổi từ ZaloPay sang VNPAY ngày 2026-11-11 (ADR 0010, ticket 18), vì ZaloPay sandbox cần tài khoản test cấp tay. Kết quả thử ZaloPay giữ ở cuối ticket làm lịch sử.

**Blocked by:** 18 (Đổi cổng thanh toán sang VNPAY)

**Status:** resolved

Hướng dẫn: `docs/vnpay.md`.

- [x] Người dùng đăng ký sandbox ở `https://pay.vnpaytest.vn/dev-registration`, rồi điền `VNPAY_TMN_CODE` và `VNPAY_HASH_SECRET` vào `.env` local (không commit), giữ `VNPAY_ENV=sandbox` và `PAYMENT_SIMULATOR=allow`
- [x] `docker compose up`; log API ghi `payments: VnpayPaymentGateway`
- [x] Đặt một đơn, trả trên trang VNPAY bằng thẻ NCB test (OTP `123456`), quay về `/don-hang/<mã>?ket-qua=1`. Kết quả: đơn thành đã trả đủ. Giao dịch có nguồn `return` thay vì `query`, vì `querydr` của sandbox lỗi (xem dưới)
- [x] Đặt một đơn, bấm hủy ở trang VNPAY. Kết quả: VNPAY trả `24`/`02`, hệ thống không ghi gì, đơn vẫn chờ thanh toán (tự hủy khi hết hạn giữ hàng)
- [x] Kiểm các điểm chưa xác minh (ticket 18), sửa code nếu khác. Chi tiết ở mục kết quả:
  - chữ ký URL thanh toán đúng;
  - `vnp_*` được nối bằng `&`;
  - `vnp_PayDate` là giờ Việt Nam;
  - trang VNPAY đếm ngược theo `vnp_ExpireDate`;
  - **`querydr` chưa xác minh được**.
- [ ] (Không bắt buộc) Tunnel HTTPS, khai URL IPN với VNPAY, trả một đơn. Kết quả mong đợi: giao dịch nguồn `webhook`. Chưa làm
- [x] Ghi kết quả và các bất ngờ vào ticket này

## Kết quả thử VNPAY sandbox (2026-11-12, agent, Playwright trên Edge)

**Chữ ký**
- VNPAY nhận URL thanh toán do dự án ký, không báo sai chữ ký.
- Trang thẻ NCB hiện đúng số tiền (3.680.000 VND), mã `vnp_TxnRef` và đếm ngược 15 phút.
- Chữ ký VNPAY gửi về trang quay về được `isValidVnpaySignature` kiểm **đúng**; sửa `vnp_Amount` thì không qua.

**Trang quay về**
- URL có dạng `/don-hang/<mã>?ket-qua=1&vnp_Amount=…&vnp_ResponseCode=00&…&vnp_SecureHash=…`.
- VNPAY nối tham số bằng `&`, nên `ket-qua=1` còn nguyên.

**`vnp_PayDate`** là giờ Việt Nam: đơn tạo link lúc `20261112105012`, trả lúc `20261112105057`.

**Bất ngờ 1, lỗi phía VNPAY:** `querydr` sandbox trả `{"vnp_ResponseCode":"99","vnp_Message":"Unexpected error"}` cho mọi request.
- Đã thử: chữ ký SHA512 lẫn SHA256, `vnp_RequestId` dài và ngắn, có và không có `vnp_TransactionNo`, nhiều IP, mã giao dịch có thật và không có thật, cả `vnp_TmnCode` sai.
- Chỉ khác khi thiếu `vnp_TransactionDate`: trả `99 "Parameter required"`.
- Kết luận: lỗi nằm phía VNPAY sandbox. Thuật toán ký `querydr` vẫn chưa xác minh.

**Cách xử lý (người dùng chốt 2026-11-12):** ghi nhận từ trang quay về (ADR 0010).
- Trang kết quả chuyển các tham số `vnp_*` có chữ ký cho `POST /api/payments/vnpay/return`.
- Route dùng chung xử lý với IPN, nguồn `return` (migration `20261112000100_payment_source_return`).

**Kết quả các đơn:**
- **#100003:** trả trong một trình duyệt khác với lúc đặt (không có token). Ghi nhận bằng cách gửi lại tham số có chữ ký đã lưu: thành đã trả.
- **#100004:** trọn luồng trong một trình duyệt, đặt mua → thẻ NCB → quay về "Đang xử lý / Đã thanh toán". Giao dịch nguồn `return`, 3.680.000, mã `15734235`.
- **#100006:** khách hủy ở trang VNPAY, VNPAY trả `24`/`02`, không ghi gì.

**Việc còn mở, chuyển sang trước khi mở bán:** hỏi VNPAY về lỗi `querydr` và thuật toán ký của lệnh này; thử IPN qua tunnel.

## Lịch sử: thử ZaloPay sandbox (trước khi đổi sang VNPAY)

Các ô kiểm cũ (dừng khi đổi cổng):

- (xong) Có app sandbox (dùng merchant dùng thử công khai `554` ở https://developer.zalopay.vn/start/); điền `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2` vào `.env` local (không commit), giữ `ZALOPAY_ENV=sandbox` và `PAYMENT_SIMULATOR=allow`
- (bỏ) Chạy tunnel tới website local, đặt `ZALOPAY_CALLBACK_URL=https://<tunnel>/api/payments/zalopay/callback`, `docker compose up`; log API ghi `payments: ZaloPayPaymentGateway`
- (bỏ) Đặt một đơn số tiền nhỏ, trả trên trang sandbox (app ZaloPay sandbox hay thẻ thử). Kết quả mong đợi: đơn thành đã trả đủ, có email, giao dịch có nguồn `webhook`
- (bỏ) Đặt thêm một đơn, trả trong lúc tunnel tắt, rồi quay về trang kết quả. Kết quả mong đợi: đơn được ghi nhận qua `refresh=1`, giao dịch nguồn `query`
- (bỏ) Kiểm các điểm chưa xác minh (ticket 17), sửa `api/src/payments/zalopay.ts` nếu khác:
  - request gửi dạng form-urlencoded có được không (repo mẫu gửi query string với body rỗng);
  - response truy vấn khi đã trả có `zp_trans_id`, `amount`, `server_time` không (thiếu `server_time` thì code lấy giờ truy vấn);
  - `amount` của callback có tính `discount_amount`/`user_fee_amount` không;
  - callback có đến cho đơn đã hết hạn không; trả sau khi `expire_duration_seconds` qua có được không.
- (bỏ) Ghi kết quả và các bất ngờ (nếu có) vào ticket này

### Kết quả thử ZaloPay (2026-11-10, agent)

- Gọi thẳng `ZaloPayPaymentGateway` với merchant `554`: `createLink` trả `order_url` (`qcgateway.zalopay.vn`) và `app_trans_id` dạng `261110_<mã>`; `getPayment` của đơn chưa trả ra `pending`. Như vậy request form-urlencoded và MAC tạo đơn, truy vấn đều đúng.
- Response truy vấn đơn chưa trả: `{"return_code":3,"sub_return_code":0,"is_processing":true,"amount":0,"zp_trans_id":0,"discount_amount":0}`, không có `server_time`.
- Bất ngờ 1: bộ khóa `2553` trong code mẫu tài liệu bị từ chối (`2/-402 Chữ ký không hợp lệ`); chỉ `554` chạy.
- Bất ngờ 3 (đã sửa): `app_trans_id` cũ là `yymmdd_<mã đơn>`, nên reset DB rồi đặt lại trong ngày (mã đơn đánh lại từ 100000) hay người khác dùng chung merchant `554` sẽ trùng mã, ZaloPay báo -68 và đặt mua lỗi 502. Nay thêm đoạn ngẫu nhiên: `yymmdd_<mã đơn>_<8 hex>`; đã thử trên sandbox hai lần cùng mã đơn 100000 trong ngày, cả hai tạo được.
- Bất ngờ 2: trang thanh toán của `554` chỉ hiện QR, không có thẻ, bất kể `bank_code`. Bước trả tiền cần người dùng quét bằng app ZaloPay sandbox trên điện thoại; agent không làm được, nên các ô trả tiền, callback, `amount` có tính phí/giảm giá không và đơn hết hạn còn chờ người dùng.
