# 03: `listAdminOrders` cạnh `loadAdminOrder`

**What to build:**
- Danh sách đơn quản trị (lọc, tìm kiếm, phân trang, map response) là một hàm của `orders/admin-order.ts`. Route `GET /admin/orders` chỉ còn parse query và trả kết quả.

**Blocked by:** —

**Status:** resolved

- [x] `listAdminOrders(prisma, query: AdminOrderQuery): Promise<AdminOrderPage>` trong `orders/admin-order.ts`, mang theo `searchWhere`, không export helper.
- [x] Thứ tự sắp xếp (theo mã đơn), cách tìm theo số điện thoại (`+84`, dấu cách, chấm, gạch) và bộ lọc `refund=open` giữ nguyên.
- [x] `admin-orders.test.ts`, `admin-orders-voucher.test.ts` và cả bộ test api xanh mà không sửa.

Spec: mục "Problem Statement" 3.

**Quyết định khi triển khai (2026-11-27):**
- `listAdminOrders(db: DbClient, query)` nhận `DbClient` như `loadAdminOrder`; thân hàm chép nguyên từ route, không đổi truy vấn. Route `GET /` còn hai dòng.
- Bộ test api (cần Docker) chạy trên CI.
