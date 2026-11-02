# 15: Dashboard admin cho đơn hàng

**What to build:**
- Bảng điều khiển admin hiện số đơn chờ soạn và số mục cần đối soát. Mỗi số chỉ hiện với người có quyền của trang tương ứng; bấm vào thì dẫn tới danh sách đã lọc sẵn.

**Blocked by:** 07 (Đơn hàng ở trang quản trị), 10 (Đối soát)

**Status:** ready-for-agent

- [ ] Lấy hai số đếm bằng API riêng, hoặc bằng API danh sách với `pageSize` nhỏ rồi đọc tổng số. Chọn một cách, ghi vào quyết định
- [ ] `web/app/pages/admin/index.vue` lọc theo quyền lấy từ `ADMIN_MENU_ITEMS` (CODING_STANDARDS "Web"), không khai lại quyền tại chỗ
- [ ] Có test qua HTTP cho số đếm, và 403 khi thiếu quyền
