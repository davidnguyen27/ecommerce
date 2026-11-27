# 01: Điều kiện trạng thái đơn dùng chung ở `shared`

**What to build:**
- `canCancelPaid` và `isDelivered` trong `shared/src/orders.ts`. API và web cùng gọi, không chép tay ở nơi nào khác.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] `canCancelPaid(order)`: `status === 'processing'`, `paymentStatus` là `paid` hoặc `deposit_paid`, `fulfillmentStatus` là `not_prepared`, `preparing` hoặc `returned`. Khớp điều kiện tổng của `cancel-paid-order.ts:48-55`.
- [ ] `isDelivered(order)`: `status === 'completed'` và `fulfillmentStatus === 'delivered'`.
- [ ] API: `cancel-paid-order.ts` và `support/support.ts:304` dùng hai hàm này sau `FOR UPDATE`. `cancel-paid-order.ts` vẫn giữ hai thông điệp lỗi hiện có, kiểm theo nhánh khi `canCancelPaid` trả `false`.
- [ ] Web: `pages/admin/orders/[code].vue`, `pages/admin/support/[code].vue`, `pages/admin/support/new.vue`, `pages/don-hang/[code].vue`, `pages/tai-khoan/don-hang/[code].vue` gọi hàm shared thay cho điều kiện viết tay.
- [ ] Test hàm thuần trong `shared` cho cả hai hàm, phủ từng nhánh (mỗi trạng thái giao hàng, đơn đã hủy mà vẫn ở `returned`).
- [ ] Bộ test api xanh mà không sửa; `pnpm smoke` qua.

**Thay đổi hành vi (web):** ở trang yêu cầu hỗ trợ (`admin/support/[code].vue`), một đơn đã hủy mà vẫn ở `returned` không mở form hủy nữa, mà hiện thông báo "Đơn không còn hủy được…" có sẵn. Trước đây form mở ra rồi API trả 409.

Spec: mục "Problem Statement" 1.
