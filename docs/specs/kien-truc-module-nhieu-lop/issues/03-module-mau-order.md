# 03: Module mẫu `order`

**What to build:**
- Đơn hàng là module nghiệp vụ đầu tiên: chốt cách service khóa dòng, mở transaction và gọi sang module khác qua interface.

**Blocked by:** 01

**Status:** resolved

- [x] `modules/order/` đủ lớp. Route admin (`/api/admin/orders`), account (`/api/account/orders`), public (`/api/orders`).
- [x] `OrderService`: chuẩn bị, bàn giao, giao, giao lỗi, giao lại, nhận hàng hoàn về, giữ hàng lại để giao; hủy đơn chưa trả và đã nhận tiền; xem/danh sách. `OrderRepository`: các truy vấn và `lockById` (`FOR UPDATE`).
- [x] Gọi sang tồn kho, thanh toán, hoàn tiền, đặt trước qua interface hẹp (`IStockCommand`, `IPaymentLinks`, …). Trong lúc các module đó chưa chuyển, interface do code cũ hiện thực (adapter tạm), ghi trong `order.module.ts`.
- [x] `IOrderQuery` cho module khác (support, report, checkout).
- [x] Xóa `routes/admin-orders.ts`, `account-orders.ts`, `public-orders.ts`; nội dung `orders/*` chuyển vào module.
- [x] Các test `order-*.test.ts`, `admin-orders*.test.ts`, `account-orders.test.ts` và cả bộ test api xanh mà không sửa.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.

**Quyết định khi triển khai (2026-11-28):**
- Module có `order.constant.ts` (include, điều kiện, URL, `parseOrderCode`) và `order.query.ts` (`OrderQuery`: xem theo token, đơn của khách, danh sách và chi tiết admin), như `category.query.ts`. `OrderService` giữ các lệnh: hủy chưa trả, hủy đã nhận tiền, hết hạn, bảy bước giao hàng. Mỗi bước giao hàng là một method công khai (`prepare`, `handOver`…) chạy qua `transition`, nơi lo audit và transaction.
- `OrderRepository.lockState`: một `SELECT … FOR UPDATE` thay ba câu khóa cũ (lấy thêm cột, vẫn cùng một khóa dòng).
- Port (`OrderPorts` trong `order.interface.ts`): tồn kho, hỏi cổng thanh toán, hoàn tiền, phân hàng về cho đơn đặt trước, đóng yêu cầu hủy, link trả phần còn lại. Kiểu lấy theo hàm cũ, nối trong `order.module.ts` (`legacyPorts`). Bảng `payment_link` vẫn đọc qua `PAYMENT_LINK_REFERENCES` của payments tới ticket 06.
- Code chưa chuyển dùng `createOrderService(deps)` / `createOrderQuery(deps)` từ `index.ts`: job hết hạn, route cổng thanh toán, đối soát, hoàn tiền, yêu cầu hỗ trợ. `cancelUnsupplied` nhận `IOrderService` thay cho `mail`; service dựng một lần trong `routes/admin.ts` (thêm `logger` vào `Pick`). `support-customer.ts` thêm `payments` vào `Pick` (app vẫn truyền đủ `AppDeps`).
- Hàm helper không cần dependency (`recordOrderEvent`, `issueOrderLookupUrl`, `remainingOf`, `DEPOSITED_PREORDER`, `toPublicOrder`…) export từ `index.ts`; khoảng 16 file cũ chỉ đổi đường dẫn import. `orders/format.ts` chuyển thành `core/utils/format.ts`.
- Thứ tự cũ giữ nguyên: route giao hàng tìm đơn (404) rồi mới parse body (400), nên controller parse body sau `orderIdOf`; `cancel-paid` và danh sách vẫn validate trước như cũ. Hủy của nhân viên ghi lỗi hủy link vào `req.log`, của khách và job vào logger chung, như trước.
- Test: 7 file chỉ đổi import `expireOverdueOrders` (vẫn là hàm với chữ ký cũ, giờ export từ module). Không đổi nội dung test.
- Kiểm local: typecheck, lint; nạp app bằng `tsx` (không lỗi import vòng) và gọi thử route không cần DB: link tra cứu thiếu token 404, admin và tài khoản chưa đăng nhập 401. Bộ test api chạy trên CI.
