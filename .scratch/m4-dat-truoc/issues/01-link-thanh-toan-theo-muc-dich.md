# 01: Link thanh toán theo mục đích

**What to build:**
- Một đơn tạo được nhiều link thanh toán, mỗi link có một mục đích (`full`, `deposit`, `remainder`). Đây là chuẩn bị cho đơn đặt trước (cọc rồi trả phần còn lại). Với đơn hàng sẵn của M3, hành vi khách thấy không đổi.

**Blocked by:** —

**Status:** resolved

- [x] Bảng link thanh toán: đơn, mục đích, số tiền, mã đơn bên cổng (duy nhất), thời điểm tạo, hạn. Migration chuyển `order.gateway_reference` cũ sang bảng này với mục đích `full`, sau đó bỏ cột cũ
- [x] Giao dịch thanh toán có cột mục đích, lấy theo link mà giao dịch thuộc về. Giao dịch cũ có mục đích `full`. Bảng vẫn chỉ ghi thêm (trigger giữ nguyên)
- [x] IPN, `return`, `refresh=1` và job hết hạn tìm đơn và truy vấn cổng qua bảng link. Đơn có nhiều link thì duyệt mọi link của đơn
- [x] Đặt mua M3 tạo link `full`. Ghi nhận thanh toán M3 chỉ coi giao dịch `full` là trả đủ
- [x] Toàn bộ test M3 (thanh toán, hết hạn, đối soát) vẫn qua, không sửa kỳ vọng
- [x] Test thêm: đơn tạo trước migration vẫn `refresh=1` và hết hạn đúng (dựng bằng SQL); mã đơn bên cổng trùng giữa hai link bị chặn

Spec: `.scratch/m4-dat-truoc/spec.md` mục "Thanh toán".

**Quyết định khi triển khai (2026-11-14):**
- Migration `20261114000100_payment_links`:
  - enum `payment_purpose` (`full`, `deposit`, `remainder`);
  - bảng `payment_link` (check `amount > 0`, unique `gateway_reference`, index `(order_id, created_at)`);
  - chép mỗi đơn có `gateway_reference` thành một link `full`, số tiền = `total`, `created_at` của đơn, hạn = `created_at` + 15 phút; rồi bỏ cột cũ cùng unique index;
  - `payment_transaction.purpose` thêm bằng `ADD COLUMN … NOT NULL DEFAULT 'full'` rồi `DROP DEFAULT`. `ADD COLUMN` không chạy trigger `UPDATE`, nên bảng chỉ-thêm-mới không phải tắt trigger.
- Giao dịch **không** có khóa ngoại tới link, chỉ có cột `purpose`. Muốn gắn link cho giao dịch cũ thì phải `UPDATE` một bảng chỉ-thêm-mới, mà M4 không cần biết giao dịch về qua link nào, chỉ cần mục đích.
- `recordPayment` nhận thêm `gatewayReference?`. Mục đích là mục đích của link mang mã đó **của chính đơn**. Không có mã, hoặc không thấy link (đơn trước khi có cột, IPN test ký với `vnp_TxnRef` khác mã cổng giả trả), thì coi là `full`. Tổng đã nhận để thành `paid` chỉ cộng giao dịch `full`; khoản `deposit`/`remainder` về đơn hàng sẵn rơi vào nhánh đối soát `amount_mismatch` như mọi khoản lệch.
- Truyền mã link: IPN và `return` truyền `vnp_TxnRef`; `recordGatewayPayments(deps, { code })` tự đọc các link của đơn (cũ trước) và truyền mã của link đang hỏi; nút giả lập truyền `gatewayReference` (tùy chọn trong `SimulatedPaymentRequest`), lấy từ tham số `ref` mà cổng giả lập thêm vào URL.
- `cancelPaymentLink` đổi thành `cancelPaymentLinks(deps, { code, paymentLinks })`: hủy mọi link của đơn, cũ trước, lỗi từng link chỉ log (log có thêm `gatewayReference`). Nơi gọi chọn link bằng `PAYMENT_LINK_REFERENCES` (`record-payment.ts`).
- `PaymentLinkRequest` có thêm `purpose`. Mã của cổng giả: link `full` vẫn là `String(orderCode)` (test M3 giữ nguyên); link khác là `<mã đơn>-<mục đích>-<n>`, với `n` đếm theo đơn và mục đích ở bản trong bộ nhớ, và 8 hex ngẫu nhiên ở cổng giả lập.
- Chi tiết đơn ở admin (`AdminPaymentTransaction`) có thêm `purpose`; schema `PaymentPurpose` nằm trong `@ecommerce/shared`. Web chưa hiện nhãn (ticket 10).
- **Còn để ticket 07:** `vnp_TxnRef` (`<mã đơn>T<giờ tạo>`) chỉ phân biệt tới từng giây. Hai lần bấm "Trả phần còn lại" trong cùng một giây sẽ trùng mã, và unique của `payment_link` sẽ chặn. Ticket 07 cần thử lại hoặc giới hạn tần suất.
- ADR 0010 có thêm dòng bổ sung về nơi lưu mã.
- Test: `api/test/payment-links.test.ts` (8 test). Toàn bộ bộ test API 41 file, 455 test qua trên máy (Docker Desktop).
