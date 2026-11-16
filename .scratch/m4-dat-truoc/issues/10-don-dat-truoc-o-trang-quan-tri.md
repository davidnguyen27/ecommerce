# 10: Đơn đặt trước ở trang quản trị và "Đặt trước cần xử lý"

**What to build:**
- Nhân viên lọc đơn theo loại và theo đợt, xem chi tiết đợt kèm danh sách đơn theo thứ tự cọc, và có danh sách "Đặt trước cần xử lý" gồm đơn quá hạn trả phần còn lại và đợt gặp sự cố có đơn đã cọc. Dashboard hiện số mục cần xử lý.

**Blocked by:** 08, 09

**Status:** resolved

- [x] Danh sách đơn thêm bộ lọc: loại đơn, đợt, "quá hạn trả phần còn lại"
- [x] Chi tiết đợt: từng biến thể có suất, đã cọc, chờ cọc, đã về; danh sách đơn theo `deposit_paid_at`, kèm trạng thái và số đã về
- [x] Chi tiết đơn: khối đặt trước (đợt, tiền cọc, phần còn lại, số đã về, hạn trả, quá hạn) và giao dịch theo mục đích
- [x] `GET` "Đặt trước cần xử lý" (`order.view`): đơn quá hạn và đợt `issue` có đơn `deposit_paid`. Trang admin tương ứng
- [x] Dashboard: số mục cần xử lý, hiện theo quyền
- [x] Test qua HTTP: các bộ lọc; số liệu của chi tiết đợt khớp với đơn dựng sẵn; danh sách cần xử lý có và không có đúng các mục; 403 khi thiếu `order.view`

Spec: mục "API quản trị", "Web".

**Quyết định khi triển khai (2026-11-16):**
- Không có migration.
- `AdminOrderQuery` có thêm `kind` (`standard` / `preorder` / `all`, mặc định `all`, nên hàng chờ soạn mặc định vẫn có cả đơn đặt trước đã trả đủ), `campaignId` và `remainderOverdue` (`z.stringbool()`: `true` là còn cờ quá hạn, `false` là không có cờ).
- Chi tiết đợt (`loadCampaign`):
  - mỗi biến thể có thêm `deposited` (đơn `deposit_paid` hay `paid`), `pendingDeposit` (đơn chờ cọc), `arrived` (đơn đã về đủ thì tính đủ số lượng, chưa về thì tính `reserved_quantity`). Tất cả tính bằng một câu SQL `campaignStats` trên đơn chưa hủy; danh sách đợt cũng dùng hàm này;
  - có thêm `orders`: đơn chưa hủy của đợt, xếp theo `deposit_paid_at` (đơn chờ cọc sau cùng) rồi mã đơn, đúng thứ tự chia hàng về; mỗi đơn có trạng thái, số đã về, lúc cọc, hạn trả, cờ quá hạn. Không phân trang (một đợt là một lần nhập hàng).
  `usedAllocations` vẫn giữ cho phần khóa suất (ticket 02, 04, 05).
- `OrderPreorder.campaignId`. Trang đơn admin có link tới đợt; bảng giao dịch có cột "Khoản" (`PAYMENT_PURPOSE_LABELS`: trả đủ / tiền cọc / phần còn lại).
- `GET /api/admin/preorder-campaigns/attention` (`order.view`, đặt trước `/:id`), trả `PreorderAttention`:
  - `overdueOrders`: đơn đặt trước `processing` + `deposit_paid` còn cờ quá hạn, xếp theo hạn trả;
  - `issueCampaigns`: đợt `supply_status = issue` còn đơn đã cọc chưa về hàng, kèm số đơn đó;
  - `total` cho dashboard.
- Web:
  - trang Đơn hàng có bộ lọc loại đơn, ô "Quá hạn trả phần còn lại", nhận `?campaignId=` và `?remainderOverdue=true` từ link, và nhãn "Đặt trước" dưới mã đơn;
  - chi tiết đợt có thêm ba cột số liệu và bảng "Đơn theo thứ tự cọc", kèm link sang trang Đơn hàng đã lọc theo đợt;
  - trang mới `/admin/preorders/attention`, mục menu "Đặt trước cần xử lý" (`order.view`);
  - dashboard có thêm số đếm "Đặt trước cần xử lý", lọc theo quyền của trang đó qua `ADMIN_MENU_ITEMS` như hai số đếm có sẵn.
- Test: `api/test/preorder-admin.test.ts` (6 test). Toàn bộ bộ test API (50 file, 528 test) và test web (12) qua.
- **Chưa xem bằng trình duyệt.** Ticket 11 (E2E) sẽ đi qua các trang này.
