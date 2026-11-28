# 03: Module mẫu `order`

**What to build:**
- Đơn hàng là module nghiệp vụ đầu tiên: chốt cách service khóa dòng, mở transaction và gọi sang module khác qua interface.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `modules/order/` đủ lớp. Route admin (`/api/admin/orders`), account (`/api/account/orders`), public (`/api/orders`).
- [ ] `OrderService`: chuẩn bị, bàn giao, giao, giao lỗi, giao lại, nhận hàng hoàn về, giữ hàng lại để giao; hủy đơn chưa trả và đã nhận tiền; xem/danh sách. `OrderRepository`: các truy vấn và `lockById` (`FOR UPDATE`).
- [ ] Gọi sang tồn kho, thanh toán, hoàn tiền, đặt trước qua interface hẹp (`IStockCommand`, `IPaymentLinks`, …). Trong lúc các module đó chưa chuyển, interface do code cũ hiện thực (adapter tạm), ghi trong `order.module.ts`.
- [ ] `IOrderQuery` cho module khác (support, report, checkout).
- [ ] Xóa `routes/admin-orders.ts`, `account-orders.ts`, `public-orders.ts`; nội dung `orders/*` chuyển vào module.
- [ ] Các test `order-*.test.ts`, `admin-orders*.test.ts`, `account-orders.test.ts` và cả bộ test api xanh mà không sửa.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.
