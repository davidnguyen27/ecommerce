# Sửa sau code review toàn nhánh M3 (2026-11-03)

Review `git diff 1fc8bb2...spec/m3-mua-hang`, hai trục (Standards, Spec). Ticket 14 (E2E) chưa nằm trong review.

## Phải sửa

1. **Test kiểm kết quả bằng prisma dù đã có HTTP** (CODING_STANDARDS "Test"). Chuyển sang đọc qua `GET /api/admin/orders/:code` (`history`, `payments`, `reconciliation`) hoặc `GET /api/admin/reconciliation`:
   - `api/test/payments.test.ts:23-32`, `:233` (SQL đọc `payment_transaction`, `reconciliation_item`);
   - `api/test/order-cancel.test.ts:121-122` (`reconciliationItem.findMany`), `:166, 221, 253` (`orderEvent.findMany`);
   - `api/test/checkout.test.ts:324-327`: giữ phần thử trigger bằng SQL, đọc sự kiện "created" qua HTTP.
   Bỏ các comment "chưa có API (ticket 07/10)" đã lỗi thời.
2. **Lịch sử đơn ở admin hiện trùng mọi thao tác của nhân viên** (`api/src/orders/admin-order.ts:36-55` gộp `order_event` + `audit_log`; hủy, chuẩn bị, bàn giao, đã giao, giao thất bại, khôi phục, đóng đối soát đều ghi cả hai). Sửa để mỗi thao tác hiện một dòng, vẫn có tên nhân viên. Audit log vẫn giữ nguyên ở trang Nhật ký kiểm toán. Có test.
3. **Hủy đơn ở admin lặp lại trả 204 không body** (`api/src/routes/admin-orders.ts:87-106`). Theo CODING_STANDARDS "không đổi gì thì không ghi gì… trả trạng thái hiện tại với 200": trả `AdminOrder` 200 (như các route giao hàng), cả khi đơn đã hủy từ trước. Cập nhật web admin dùng response. Chuyển trạng thái giao hàng lặp lại vẫn 409 (giữ, coi như kiểm tra đồng thời).
4. **Webhook trả body không có kiểu** (`api/src/routes/payments.ts:46`): thêm schema shared cho `{ success: true }` và gán kiểu.
5. **Tiền về đủ sau khi đã trả thiếu để lại mục đối soát mồ côi** (`api/src/payments/record-payment.ts:75-101`): đơn thành `paid` nhờ khoản thứ hai nhưng mục `amount_mismatch` của khoản đầu vẫn `open`, hiện ở dashboard. Khi đơn chuyển `paid`, đóng các mục `amount_mismatch` còn mở của đơn đó với cách xử lý mới (ví dụ `settled_by_payment`, migration thêm giá trị enum, nhãn web), ghi sự kiện đơn. Có test.
6. **Test thiếu**: `GET /api/admin/orders/:code` khi thiếu `order.view` trả 403 (dùng nhân viên bị gỡ hết vai trò như `admin-dashboard.test.ts`).
7. **`quote` báo còn hàng không theo số lượng** (`api/src/routes/checkout.ts:58,64`): `inStock` của dòng tính theo `on_hand - reserved >= quantity` để trang giỏ và đặt mua báo thiếu hàng trước khi đặt (spec "trả từng dòng với giá hiện tại, còn hàng hay không"; user story 12). Giữ không lộ số tồn. Cập nhật test và nhãn web nếu cần ("Không đủ hàng").
8. **Ô Phường/xã và Tỉnh/thành ở `/dat-mua`**: label bọc `<select>` nên tên truy cập lẫn chữ của option (getByLabel('Tỉnh/thành') trúng cả hai ô). Dùng `for`/`id` thay vì bọc.
8b. **Tên truy cập của link giỏ ở header** đọc thành "Giỏ hàng , 1 món" (thừa dấu cách trước dấu phẩy): sửa để đọc "Giỏ hàng, 1 món".

## Nên gộp (judgement call, làm nếu gọn)

9. `notFound` "Không tìm thấy đơn hàng" khai ở 4 file (`orders.ts:91`, `admin-order.ts:8`, `admin-orders.ts:22`, `payments.ts:12`) và regex mã đơn `/^\d{1,9}$/` lặp (`admin-order.ts:15`, `orders.ts:98,113`, `admin-orders.ts:29,36`): một `parseOrderCode()`/`orderNotFound()` chung.
10. Bốn route giao hàng (`admin-orders.ts:108-172`) chép nhau, trạng thái before/after khai ở route còn trạng thái nguồn khai ở `fulfill-order.ts`: để mỗi hàm chuyển trạng thái trả before/after cho audit, route dùng một helper.

## Không sửa, ghi lại cho chủ doanh nghiệp
- Tiền về sau hạn giữ hàng nhưng trước khi job hết hạn chạy (tối đa khoảng 1 phút) thì đơn vẫn thành đã trả (ticket 05 đã chọn, hàng vẫn đang giữ).
- Khách trả thiếu rồi chuyển lại đủ tiền: tổng nhận lớn hơn tổng đơn nên đơn bị gắn cờ và hết hạn, không khôi phục được vì spec đòi "tổng đã nhận bằng đúng tổng phải trả". Kế toán xử lý ngoài hệ thống.

## Đã sửa

1. Xong. `payments.test.ts`, `order-cancel.test.ts`, `checkout.test.ts` đọc kết quả qua HTTP; chỉ còn SQL ở phần thử trigger và hàng đợi pg-boss. Bỏ các comment "chưa có API".
2. Xong. `history` chỉ còn sự kiện đơn, mỗi thao tác một dòng; bỏ trường `source`. Test đọc trước/sau qua `/api/admin/audit`.
3. Xong. Hủy ở admin trả `AdminOrder` 200, kể cả đơn đã hủy từ trước; web dùng response.
4. Bỏ qua, route sẽ được thay khi đổi sang ZaloPay.
5. Xong. `settled_by_payment` (migration `20261103000100`, nhãn web), ghi vào sự kiện `paid` thay vì một loại sự kiện mới để mỗi thao tác vẫn một dòng.
6. Xong. Test 403 trong `admin-orders.test.ts`.
7. Xong. `enoughStockIds`, nhãn giỏ "Không đủ hàng, hãy giảm số lượng hoặc bỏ khỏi giỏ".
8. Xong. Dùng `for`/`id`, giữ `name=province`, `name=ward` cho E2E.
8b. Xong. Tên đặt bằng `aria-label` trên link (ghép từ các span trong flex thì trình duyệt chèn dấu cách); E2E so đúng chuỗi.
9. Xong trừ `routes/payments.ts` (route sẽ thay khi đổi cổng). Regex trong `searchWhere` giữ nguyên vì đó là ô tìm kiếm, không phải mã đơn từ URL.
10. Xong. Hàm chuyển trạng thái trả `FulfillmentAudit`, route dùng helper `transition`.
