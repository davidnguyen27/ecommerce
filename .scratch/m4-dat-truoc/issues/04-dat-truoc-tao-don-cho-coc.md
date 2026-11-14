# 04: Đặt trước tạo đơn chờ cọc

**What to build:**
- Khách bấm "Đặt trước", chọn 1–5 cái, nhập thông tin nhận hàng, xem bảng tiền (tiền hàng, phí giao, tổng, tiền cọc, phần còn lại), thời gian giao dự kiến, hạn trả phần còn lại, đồng ý chính sách đặt trước, rồi được chuyển tới VNPAY để trả cọc. Đơn chờ cọc chiếm suất trong 15 phút. Quá hạn thì tự hủy, và khách tự hủy được khi chưa cọc.

**Blocked by:** 01, 03

**Status:** resolved

- [x] Chính sách đặt trước là một trang chính sách có slug cố định (như chính sách bảo mật). Chưa có phiên bản xuất bản thì `quote` và `preorders` trả 503
- [x] Đơn có loại (`standard`, `preorder`). Đơn `preorder` có một dòng đơn, tham chiếu đợt, và chụp lại tỷ lệ cọc, tiền cọc, thời gian giao dự kiến, số ngày trả phần còn lại, phiên bản chính sách đặt trước. Tiền cọc = làm tròn lên 1.000 của tiền hàng × tỷ lệ / 100. Check `0 < deposit_amount <= subtotal`
- [x] `POST /api/preorders/quote` và `POST /api/preorders` theo spec mục "Đặt trước": khóa biến thể và dòng biến thể của đợt `FOR UPDATE`; kiểm đang nhận đặt trước, giá, tỷ lệ cọc, đợt; có hàng sẵn thì 409 `in_stock`; các thay đổi khác cũng 409 kèm `details`, không ghi gì; không đụng `reserved`; tạo link `deposit` với hạn 15 phút
- [x] Đồng ý chính sách bảo mật (khách vãng lai) và đồng ý chính sách đặt trước (mọi khách) là bắt buộc. Giới hạn tần suất và số đơn đang chờ dùng chung bộ đếm với `POST /api/checkout`
- [x] Hết hạn và hủy chưa cọc (token, tài khoản, nhân viên) dùng lại M3. Đơn `preorder` không có hàng giữ nên không nhả gì; suất tự trống ra
- [x] Web: trang `/dat-truoc/<variantId>` (`noindex`) như spec mục "Web". Trang kết quả thanh toán dùng lại M3. Trang đơn hàng hiện khối đặt trước (tiền cọc, còn lại, thời gian giao dự kiến). `scripts/smoke.ts` thêm trang này
- [x] Test qua HTTP: tạo đơn và link đúng tiền cọc (có ca làm tròn); `reserved` không đổi; mỗi lý do 409 không ghi gì; thiếu đồng ý chính sách đặt trước bị từ chối; 503 khi chưa có chính sách; nhiều khách tranh suất cuối song song thì đúng một đơn; hết hạn thì hủy và trống suất; khách hủy chưa cọc

Spec: mục "Mô hình đơn", "Đặt trước", ADR 0012.

**Quyết định khi triển khai (2026-11-15):**
- Migration `20261115000100_preorder_orders` thêm vào `order`:
  - enum `order_kind`, cột `kind` mặc định `standard`;
  - các cột `deposit_percent`, `deposit_amount`, `delivery_from`, `delivery_to`, `remainder_days`;
  - check `order_preorder_check`: đơn hàng sẵn không có đợt và không có trường cọc nào; đơn đặt trước có đủ, với cọc 10–100%, `0 < deposit_amount <= subtotal`, `delivery_from <= delivery_to`, `remainder_days >= 1`.
  Đã đối chiếu với schema trên Postgres tạm: không lệch.
- Phiên bản chính sách đặt trước (slug `PREORDER_POLICY_SLUG = 'chinh-sach-dat-truoc'`, loại `policy`) nằm trong `order_policy_version` cùng chính sách đổi trả của sản phẩm, nên `PublicOrder.policies` liệt kê cả nó. Chưa xuất bản thì `quote` vẫn trả (với `preorderPolicy: null`, trang báo chưa nhận đặt trước) còn `POST /api/preorders` trả 503. Ticket ghi "`quote` cũng 503"; mình chọn trả báo giá để trang hiện được sản phẩm và lý do.
- `depositFor(subtotal, percent)` nằm trong `@ecommerce/shared`, dùng chung cho API và web: làm tròn lên 1.000 VND, không vượt tiền hàng.
- `PreorderQuote` có `offer` (đợt đang mở kèm `remainderDays`, có cả khi hết suất) và `problem` (`in_stock` / `campaign` / `sold_out` / `discontinued`, hoặc `null`), thay cho một boolean `inStock`.
- `checkPreorder(db, variantId, quantity, { lock })` (`api/src/preorders/check.ts`) dùng chung cho báo giá và đặt trước. Khi `lock`, nó khóa dòng biến thể rồi dòng suất (`FOR UPDATE OF cv`). Ngừng bán đọc từ trạng thái hiện tại như `cartVariants`.
- Thứ tự kiểm khi đặt: ngừng bán → có hàng sẵn → đợt (không có hay khác `campaignId`) → giá → mức cọc → hết suất. 409 trả `details: { change }` (`PreorderConflictDetails`), không ghi gì.
- Đặt mua M3 và đặt trước dùng chung `api/src/checkout/order-snapshot.ts`: `storedImageOf`, `livePolicyVersions` (chuyển từ `routes/checkout.ts` sang) và `createOrderPaymentLink` (tạo link ở cổng rồi lưu `payment_link`). Link cọc có mục đích `deposit`, mô tả "Đặt cọc đơn hàng #…".
- Giới hạn tần suất theo IP và số đơn chờ thanh toán theo email/số điện thoại dùng chung bộ đếm với đặt mua.
- Hủy (hết hạn, khách, nhân viên): `cancelInTransaction` đọc `kind` và **không** gọi `releaseStock` cho đơn đặt trước, vì đơn chờ cọc không giữ hàng.
- `restoreOrder` (đối soát) trả 409 với đơn đặt trước cho tới ticket 05, vì khôi phục kiểu M3 sẽ giữ hàng cho đơn chưa có hàng.
- **Tới ticket 05:** cọc về qua IPN sẽ rơi vào nhánh đối soát `amount_mismatch`, vì `recordPayment` mới chỉ coi giao dịch `full` là trả đủ. Ticket 05 thêm nhánh `deposit` → `deposit_paid`.
- `PublicOrder` có thêm `kind` và `preorder` (`OrderPreorder`: mức cọc, tiền cọc, phần còn lại, ngày giao, số ngày trả). `AccountOrderSummary` (cùng `AdminOrderSummary`) có thêm `kind`.
- Web:
  - **Tách phần form thông tin nhận hàng của trang đặt mua** thành `useShippingForm()` (state, điền sẵn địa chỉ lần trước, nạp phường/xã, `contactPayload()`, `revealErrors()`) và `CheckoutContactFields.vue`. Component nhận form qua `defineModel`, giữ nguyên id và name của các ô. `dat-mua.vue` dùng hai phần này, giảm từ 423 xuống 263 dòng.
  - `/dat-truoc/[variantId]` là trang thật: báo giá theo số lượng và tỉnh/thành; bảng tiền gồm tiền hàng, phí giao, tổng, cọc, còn lại; thời gian giao dự kiến và số ngày trả phần còn lại; ô đồng ý chính sách đặt trước (mọi khách) và chính sách bảo mật (khách vãng lai). Gặp 409 thì tải lại báo giá và hiện lý do; nếu chỉ đổi giá, mức cọc hay đợt thì khách đặt lại được ngay với số mới.
  - `OrderView`: đơn đặt trước nói "suất" thay cho "hàng"; hết hạn thì không có nút "Quay lại giỏ hàng"; có dòng tiền cọc, còn lại khi hàng về và đoạn thời gian giao dự kiến.
- Test:
  - `api/test/preorders.test.ts` (14 test) và helper `api/test/support/preorder.ts`;
  - các test của ticket 02 và 03 chuyển sang đặt trước thật qua HTTP thay cho việc gắn đợt vào đơn thường bằng `prisma`, vì check mới cấm đơn hàng sẵn có đợt;
  - `account-orders.test.ts` so khớp tuyệt đối nên phải thêm `kind: 'standard'` vào kỳ vọng.
  Toàn bộ bộ test API (44 file, 489 test) và test web (12) qua trên máy.
- **Chưa chạy `pnpm smoke` hay E2E và chưa xem bằng trình duyệt.** Trang đặt mua đã được tách form nên E2E đặt mua của M3 (chạy trên CI) là lớp kiểm tra quan trọng.
