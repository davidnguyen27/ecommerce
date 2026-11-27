# 03: `listAdminOrders` cạnh `loadAdminOrder`

**What to build:**
- Danh sách đơn quản trị (lọc, tìm kiếm, phân trang, map response) là một hàm của `orders/admin-order.ts`. Route `GET /admin/orders` chỉ còn parse query và trả kết quả.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] `listAdminOrders(prisma, query: AdminOrderQuery): Promise<AdminOrderPage>` trong `orders/admin-order.ts`, mang theo `searchWhere`, không export helper.
- [ ] Thứ tự sắp xếp (theo mã đơn), cách tìm theo số điện thoại (`+84`, dấu cách, chấm, gạch) và bộ lọc `refund=open` giữ nguyên.
- [ ] `admin-orders.test.ts`, `admin-orders-voucher.test.ts` và cả bộ test api xanh mà không sửa.

Spec: mục "Problem Statement" 3.
