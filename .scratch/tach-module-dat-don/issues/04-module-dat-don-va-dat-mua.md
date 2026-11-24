# 04: Module đặt đơn, chuyển đặt mua vào

**What to build:**
- Tạo `orderPlacement(deps)` với pipeline cố định thứ tự các bước và plan đặt mua. Handler `POST /api/checkout` chỉ còn parse body, giới hạn theo IP, dựng `Placer`, gọi `placement.checkout` và trả 201.

**Blocked by:** 01, 02, 03

**Status:** ready-for-agent

- [ ] `api/src/orders/place-order.ts` export `orderPlacement`, `PlacementDeps` và `Placer` đúng như spec. Chưa có entry point `preorder` (ticket 05).
- [ ] Pipeline chạy 10 bước theo đúng thứ tự trong mục "Bất biến module bảo đảm", trong một transaction `{ timeout: 30_000, maxWait: 10_000 }`.
- [ ] Bất biến được ghi một lần ở đầu pipeline: thứ tự khóa, mã giảm giá kiểm sau dòng, link thanh toán gọi sau cùng. Comment tương ứng trong route bị xóa.
- [ ] Plan đặt mua làm các việc sau, nội bộ, không export:
  - gom mọi dòng sai (`discontinued`, `price`, `out_of_stock`) theo thứ tự input;
  - giữ hàng các dòng đúng trước khi ném 409;
  - tiền giảm từng dòng lấy từ `applied.lines`;
  - mục đích thanh toán `full`.
- [ ] Mọi thông điệp lỗi, `fields`, body 409 và mã trạng thái giữ nguyên từng chữ, gồm cả 400, 429, 503 và 502.
- [ ] `routes/checkout.ts` không còn import `wardName`, `reserveStock`, `cartVariants` (ngoài báo giá), `applyVoucherToOrder`, `voucherSnapshot`, `createOrderPaymentLink`, `enforcePendingOrderLimit`, `hashOpaqueToken`, `newOpaqueToken`, `recordOrderEvent`.
- [ ] Bước 1 của pipeline phân biệt đặt mua và đặt trước bằng tham số nội bộ, không bằng union ở interface.
- [ ] `checkout*.test.ts`, `admin-orders-voucher.test.ts`, `payment-links.test.ts`, `order-cancel.test.ts` và cả bộ test của api xanh mà không sửa.

Spec: mục "Interface của module", "Bất biến module bảo đảm", "Lỗi", "Bên trong module".
