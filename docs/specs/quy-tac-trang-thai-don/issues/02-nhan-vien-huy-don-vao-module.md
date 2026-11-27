# 02: Nhân viên hủy đơn đi qua module `orders/`

**What to build:**
- Hai route hủy đơn của nhân viên chỉ còn parse, kiểm quyền, gọi module, đọc lại đơn và trả response. Việc ghi audit trong transaction và hủy link sau commit nằm trong module.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] Kiểu `AuditedRun` (xem spec, mục "Implementation Decisions"), export từ `audit/audited.ts`.
- [ ] `orders/cancel-order.ts`: `cancelOrderByStaff(deps, run, orderId, staffId)` chạy `cancelInTransaction`, chỉ ghi audit `order.cancel` khi kết quả là `cancelled`, gọi `assertCancellable`, rồi hủy link thanh toán sau commit. Nội dung audit giữ nguyên.
- [ ] `orders/cancel-paid-order.ts`: `cancelPaidOrderByStaff(deps, run, orderId, staffId, input)` bọc `cancelPaidOrder` rồi hủy link sau commit. `cancelPaidOrder` giữ nguyên chữ ký, vì `preorders/unsupplied.ts` vẫn gọi.
- [ ] `routes/admin-orders.ts` không còn import `cancelInTransaction` hay `cancelPaymentLinks`. Nếu không còn nơi nào ngoài module dùng, bỏ export của chúng.
- [ ] `order-cancel.test.ts`, `order-cancel-paid.test.ts`, `preorder-cancel-paid.test.ts`, `admin-orders.test.ts` và cả bộ test api xanh mà không sửa.

Spec: mục "Problem Statement" 2.
