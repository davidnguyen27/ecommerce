# 05: Ghi nhận thanh toán

**What to build:**
- Tiền về đúng số thì đơn thành đã trả đủ, và khách nhận email xác nhận. Có hai đường ghi nhận: webhook của cổng, và truy vấn khi khách quay về trang kết quả.
- Tiền về lệch, về thêm, hoặc về cho đơn đã hủy thì đơn được gắn cờ cần đối soát. Hệ thống không tự xử lý.
- Cổng giả lập có nút "Giả lập đã thanh toán", để đi trọn luồng khi chạy local.

**Blocked by:** 03 (Đặt mua và giữ hàng)

**Status:** resolved

- [x] Bảng giao dịch thanh toán chỉ ghi thêm, trigger chặn sửa và xóa. Mỗi giao dịch có: đơn, số tiền, mã tham chiếu (unique), thời điểm, nguồn (`webhook`, `query` hoặc `simulator`), payload gốc
- [x] Cờ cần đối soát, đặt trên đơn hoặc ở bảng riêng, gồm:
  - lý do: `amount_mismatch`, `paid_after_cancel` hoặc `extra_payment`;
  - số tiền nhận và thời điểm;
  - trạng thái `open` hoặc `resolved`.
- [x] Chỉ có một hàm ghi nhận thanh toán, chạy nhiều lần vẫn cho một kết quả:
  1. Khóa đơn `FOR UPDATE`.
  2. Giao dịch đã ghi rồi thì bỏ qua.
  3. Đơn đang `pending_payment` và tổng đã nhận bằng đúng tổng phải trả: chuyển sang `paid` + `processing`, bỏ hạn giữ hàng, ghi sự kiện đơn, xếp email "đã nhận thanh toán" trong cùng transaction.
  4. Mọi trường hợp khác: gắn cờ cần đối soát kèm lý do, không đổi trạng thái đơn.
- [x] Hàm thuần kiểm chữ ký webhook PayOS: HMAC-SHA256 trên `data`, key xếp theo alphabet, `null` đổi thành chuỗi rỗng
- [x] `POST /api/payments/payos/webhook` không cần đăng nhập:
  - sai chữ ký thì trả 400, không ghi gì;
  - đã xử lý, hoặc giao dịch đã ghi từ trước, thì trả 2xx.
- [x] `GET /api/orders/:code?token=…&refresh=1` truy vấn cổng theo mã đơn, ghi nhận các giao dịch mới, rồi mới trả đơn
- [x] Trang kết quả thanh toán (`returnUrl`) tự gọi `refresh=1`
- [x] Cổng giả lập có nút "Giả lập đã thanh toán" (đúng số tiền) và cho nhập số tiền khác để thử trường hợp lệch tiền
- [x] Email "đã nhận thanh toán" gồm tóm tắt đơn, tổng tiền và link tra cứu. Nội dung là bản nháp, chờ chủ doanh nghiệp duyệt
- [x] Có test qua HTTP, webhook tự ký bằng checksum key của test:
  - đúng chữ ký, đúng tiền: đơn thành đã trả đủ, email gửi đúng một lần;
  - sai chữ ký: 400, không ghi gì;
  - cùng một webhook gửi hai lần: chỉ ghi một giao dịch;
  - `refresh=1` ghi nhận được khi chưa có webhook;
  - webhook và truy vấn cùng về: chỉ ghi một lần;
  - lệch tiền: cần đối soát, đơn vẫn chưa thanh toán;
  - tiền về thêm cho đơn đã trả: cần đối soát `extra_payment`;
  - bảng giao dịch không sửa, không xóa được (thử bằng SQL trực tiếp)

**Điểm dừng:** xong ticket này, người dùng tự đi thử luồng giỏ → đặt mua → giả lập thanh toán trên máy rồi mới chạy tiếp.

**Quyết định khi triển khai (2026-11-02):**
- Migration `20261102000500_payments`:
  - Bảng `payment_transaction` (`PaymentTransaction`): `order_id`, `amount` BIGINT > 0, `reference` unique (toàn bảng), `paid_at`, `source` enum `payment_source` (`webhook | query | simulator`), `payload` JSONB, `created_at`. Trigger `payment_transaction_append_only` chặn UPDATE/DELETE/TRUNCATE.
  - Cờ cần đối soát ở bảng riêng `reconciliation_item` (`ReconciliationItem`): `order_id`, `transaction_id` (unique, mỗi khoản tiền nhiều nhất một mục), `reason` enum `reconciliation_reason`, `amount` (số tiền của khoản đó), `received_at`, `status` enum `reconciliation_status` (`open | resolved`, mặc định `open`), `created_at`, `updated_at`. Index `(status, created_at)` cho danh sách ở ticket 10. Ticket 10 thêm cột ghi chú/người xử lý khi cần.
  - Bảng `order_lookup_token` (`OrderLookupToken`: `token_hash` PK, `order_id`): token tra cứu cấp thêm cho link trong email, vì DB chỉ giữ hash của token lúc đặt mua nên không dựng lại được link. `findOrderByToken` nhận cả token lúc đặt mua lẫn token trong bảng này. Hàm `issueOrderLookupUrl(db, siteUrl, order)` (`api/src/orders/orders.ts`) cấp token mới và trả link; ticket 09 dùng cho email bàn giao.
- Hàm ghi nhận duy nhất `recordPayment({ prisma, emails, siteUrl }, PaymentReceipt)` ở `api/src/payments/record-payment.ts`, trả `'paid' | 'flagged' | 'duplicate' | 'unknown_order'`. Một transaction: khóa đơn theo `code` `FOR UPDATE`, bỏ qua nếu `reference` đã có, ghi giao dịch, cộng mọi giao dịch của đơn. Đơn `pending_payment` và tổng nhận = `total` thì `processing` + `paid`, `reserved_until = null`, sự kiện `paid` (actor `system`, `data: { amount, reference, source }`), email. Còn lại: lý do `paid_after_cancel` nếu đơn `cancelled`, `extra_payment` nếu đã `paid`, ngược lại `amount_mismatch`; sự kiện `payment_flagged` (thêm `reason`). Trùng `reference` song song giữa hai đơn khác nhau thì unique chặn và trả `duplicate`.
  - Đơn `pending_payment` đã quá `reserved_until` nhưng job hết hạn (ticket 06) chưa chạy vẫn được ghi đã trả, vì hàng vẫn còn giữ. Ticket 06 hủy đơn dưới cùng khóa `FOR UPDATE` thì không đụng nhau.
  - Trả thiếu rồi trả thêm cho đủ: khoản đầu thành `amount_mismatch` (mục vẫn `open`), khoản sau làm đơn thành đã trả. Kế toán đóng mục ở ticket 10.
- `OrderEventKind` thêm `paid` và `payment_flagged`.
- Chữ ký PayOS: `payosSignature`, `isValidPayosSignature` (so sánh thời gian hằng), `parsePayosDateTime` (giờ `yyyy-MM-dd HH:mm:ss` của PayOS hiểu là +07:00) ở `api/src/payments/payos.ts`. Mảng thành JSON với key xếp alphabet như SDK chính thức.
- `POST /api/payments/payos/webhook` (router `paymentRoutes(deps)`, `api/src/routes/payments.ts`): chỉ mở khi có `AppDeps.payosChecksumKey` (server đọc `PAYOS_CHECKSUM_KEY`; ticket 12 đưa biến này vào config và `.env.example`). Kiểm chữ ký trên `data` gốc trước khi parse; sai hoặc thiếu thì 400 `VALIDATION_ERROR`, không ghi gì. Chỉ ghi khi `code` và `data.code` là `00`. Mã đơn lạ (webhook thử lúc PayOS xác nhận URL) vẫn 200. Response `{ success: true }`. Schema `PayosWebhook` ở `shared/src/payments.ts`.
- `GET /api/orders/:code?token=…&refresh=1`: kiểm token trước (sai thì 404, không hỏi cổng), rồi `payments.getPayment(code)` và `recordPayment` từng giao dịch với nguồn `query`. Cổng lỗi thì log và trả đơn như hiện có. `InMemoryPaymentGateway` thêm `failGetPayment`.
- **Sửa từ ticket 03:** `returnUrl` và `cancelUrl` gửi cổng là `paymentResultUrl(siteUrl, code)` = `/don-hang/<code>?ket-qua=1`, không còn token, nên cổng thanh toán không thấy link xem và hủy đơn. Trang đặt mua lưu token vào `sessionStorage` (`rememberOrderToken`/`recallOrderToken`, `web/app/utils/orderToken.ts`, có try/catch) trước khi chuyển tới cổng; trang `/don-hang/[code]` lấy token từ query `token` (link email) hoặc từ sessionStorage. Thiếu token thì báo khách mở đơn bằng link trong email xác nhận (`data-testid="order-token-missing"`). Test `link gửi cổng chỉ mang mã đơn…` kiểm cổng không nhận token. Mục "Cần chủ doanh nghiệp xác nhận" về `returnUrl` của ticket 03 không còn.
- Trang kết quả là chính `/don-hang/[code]` với `?ket-qua=1`: tự gọi `refresh=1`; đơn còn chờ thanh toán thì hiện "Chưa nhận được thanh toán…" kèm nút "Kiểm tra lại" (`data-testid="payment-pending"`).
- Cổng giả lập: `POST /api/payments/simulator/paid` body `SimulatedPaymentRequest { orderCode, amount }`, chỉ đăng ký khi `deps.payments` là `SimulatorPaymentGateway`; gọi `recordPayment` nguồn `simulator`, `reference` `SIM-<mã>-<uuid>`; 204, mã lạ 404. Không cần đăng nhập. Trang `/thanh-toan-gia-lap` có ô "Số tiền chuyển (VND)" (`data-testid="simulate-amount"`, mặc định đúng tổng) và nút `simulate-paid`; xong thì về `returnUrl` cùng origin. `createTestApp({ simulator: true })` (và `shop(options)`, `appWithOwner(options)`) dùng cổng giả lập thay bản trong bộ nhớ.
  - Hiện `paymentGatewayFromEnv` luôn trả cổng giả lập, kể cả production, nên API giả lập thanh toán mở ở mọi môi trường cho tới ticket 12 (chặn khởi động production khi thiếu khóa PayOS). Không được deploy thật trước ticket 12.
- Email "Đã nhận thanh toán đơn hàng #<mã>": chào tên người nhận, từng dòng (tên, thuộc tính, số lượng, thành tiền), phí giao, tổng, link tra cứu có token mới, câu báo sẽ thông báo khi bàn giao vận chuyển. **Cần chủ doanh nghiệp xác nhận** nội dung (bản nháp).
- Smoke thêm `/don-hang/100000?ket-qua=1` (khung, `noindex`) và kiểm trang giả lập có nút và ô số tiền. Chưa đi luồng bằng trình duyệt (ticket 14).
- Test: `api/test/payments.test.ts` (15 test), helper `api/test/support/payos.ts` (`webhookData`, `signedWebhook` ký độc lập bằng `PAYOS_CHECKSUM_KEY` của `test-app.ts`). Có thêm: webhook mã đơn lạ, tiền về cho đơn đã hủy (dựng đơn hủy bằng prisma vì chưa có đường hủy), cổng lỗi khi `refresh=1`, token sai với `refresh=1`.
