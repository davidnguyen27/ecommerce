# 02: Nhân viên hủy đơn đi qua module `orders/`

**What to build:**
- Hai route hủy đơn của nhân viên chỉ còn parse, kiểm quyền, gọi module, đọc lại đơn và trả response. Việc ghi audit trong transaction và hủy link sau commit nằm trong module.

**Blocked by:** —

**Status:** resolved

- [x] Kiểu `AuditedRun` (xem spec, mục "Implementation Decisions"), export từ `audit/audited.ts`.
- [x] `orders/cancel-order.ts`: `cancelOrderByStaff(deps, run, orderId, staffId)` chạy `cancelInTransaction`, chỉ ghi audit `order.cancel` khi kết quả là `cancelled`, gọi `assertCancellable`, rồi hủy link thanh toán sau commit. Nội dung audit giữ nguyên.
- [x] `orders/cancel-paid-order.ts`: `cancelPaidOrderByStaff(deps, run, orderId, staffId, input)` bọc `cancelPaidOrder` rồi hủy link sau commit. `cancelPaidOrder` giữ nguyên chữ ký, vì `preorders/unsupplied.ts` vẫn gọi.
- [x] `routes/admin-orders.ts` không còn import `cancelInTransaction` hay `cancelPaymentLinks`. Nếu không còn nơi nào ngoài module dùng, bỏ export của chúng.
- [x] `order-cancel.test.ts`, `order-cancel-paid.test.ts`, `preorder-cancel-paid.test.ts`, `admin-orders.test.ts` và cả bộ test api xanh mà không sửa.

Spec: mục "Problem Statement" 2.

**Quyết định khi triển khai (2026-11-27):**
- `cancelPaymentLinks(deps, order)` đổi thành `cancelOrderPaymentLinks(deps, orderId)`: hàm tự đọc link sau commit, nên `cancelOrder`, `cancelOrderByStaff` và `cancelPaidOrderByStaff` cùng dùng một bản. Route không còn phải đọc `paymentLinks` trước transaction.
- `cancelInTransaction` không còn export.
- Route dựng `AuditedRun` và `CancelDeps` (logger là `req.log`, như trước) qua hai helper nhỏ trong `adminOrderRoutes`.
- Bộ test api (cần Docker) chạy trên CI.
