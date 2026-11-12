# 15: Dashboard admin cho đơn hàng

**What to build:**
- Bảng điều khiển admin hiện số đơn chờ soạn và số mục cần đối soát. Mỗi số chỉ hiện với người có quyền của trang tương ứng; bấm vào thì dẫn tới danh sách đã lọc sẵn.

**Blocked by:** 07 (Đơn hàng ở trang quản trị), 10 (Đối soát)

**Status:** resolved

- [x] Lấy hai số đếm bằng API riêng, hoặc bằng API danh sách với `pageSize` nhỏ rồi đọc tổng số. Chọn một cách, ghi vào quyết định
- [x] `web/app/pages/admin/index.vue` lọc theo quyền lấy từ `ADMIN_MENU_ITEMS` (CODING_STANDARDS "Web"), không khai lại quyền tại chỗ
- [x] Có test qua HTTP cho số đếm, và 403 khi thiếu quyền

**Quyết định khi triển khai (2026-11-02):**
- Chọn dùng lại API danh sách, không thêm endpoint: `GET /api/admin/orders?pageSize=1` (mặc định là hàng chờ soạn `processing` / `paid` / `not_prepared`, ticket 07) và `GET /api/admin/reconciliation?pageSize=1` (mặc định `open`, ticket 10), đọc `total`. Cả hai cần `order.view`. Không có quyền mới, không migration.
- `web/app/pages/admin/index.vue`: hàm `canOpen(to)` đọc quyền từ `ADMIN_MENU_ITEMS`, dùng chung cho lối tắt và hai thẻ số đếm (`ORDER_COUNTS`). Thẻ là link tới `/admin/orders` và `/admin/reconciliation`; hai trang này mặc định đã lọc đúng nên link không mang query. `data-testid`: `dashboard-to-pick`, `dashboard-reconciliation`. Các phần cũ của dashboard (sản phẩm, thương hiệu, kiểm toán) giữ nguyên cách kiểm quyền cũ.
- Test: `api/test/admin-dashboard.test.ts` (2 test): số đếm với vai trò sales; 403 `FORBIDDEN` cho cả hai API. Vì mọi vai trò đều có `order.view`, test 403 dùng nhân viên bị gỡ hết vai trò (sửa `roles = []` qua Prisma, vì API tạo nhân viên bắt buộc ít nhất một vai trò).
- Smoke không đổi (trang admin SPA). Chưa xem trang bằng trình duyệt (ticket 14).
