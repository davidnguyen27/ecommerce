# 10: Đối soát

**What to build:**
- Kế toán xem danh sách đơn cần đối soát (số tiền nhận, số tiền của đơn, lý do) và xử lý từng mục theo một trong hai cách: khôi phục đơn khi đủ điều kiện, hoặc ghi là đã xử lý ngoài hệ thống.

**Blocked by:** 06 (Hết hạn và hủy đơn chưa thanh toán), 07 (Đơn hàng ở trang quản trị)

**Status:** resolved

- [x] Thêm quyền mới `payment.reconcile` (owner, accountant). Danh sách cần đối soát đọc được với `order.view`
- [x] Khôi phục đơn chỉ được khi đủ ba điều kiện:
  - đơn đang `cancelled`;
  - tổng đã nhận bằng đúng tổng phải trả;
  - giữ lại được đủ hàng (qua hàm giữ hàng của kho). Không đủ hàng thì 409 theo dòng.

  Khôi phục xong: đơn thành `paid` + `processing`, gửi email đã nhận thanh toán, đóng mục đối soát.
- [x] "Đã xử lý ngoài hệ thống": ghi chú bắt buộc (số tiền, mã giao dịch ngân hàng); đóng mục, không đổi trạng thái đơn
- [x] Cả hai thao tác đi qua `audited()` và ghi sự kiện đơn
- [x] Web:
  - menu "Cần đối soát", quyền `order.view`;
  - nút thao tác chỉ hiện với `payment.reconcile`;
  - trang chi tiết đơn có khối đối soát.
- [x] Có test qua HTTP:
  - khôi phục được khi đủ điều kiện;
  - khôi phục khi thiếu hàng thì 409;
  - khôi phục khi lệch tiền bị từ chối;
  - đóng mục thiếu ghi chú thì 400;
  - thiếu `payment.reconcile` thì 403;
  - có ghi audit

**Quyết định khi triển khai (2026-11-02):**
- Quyền `payment.reconcile` mới trong `Permission` (shared) và `ROLE_PERMISSIONS` (owner qua `Permission.options`, accountant).
- Migration `20261102001000_reconciliation`: enum `reconciliation_resolution` (`restored | handled_externally`); cột `reconciliation_item.resolution`, `note`, `resolved_by_id` (FK `staff`), `resolved_at`. Check `reconciliation_item_resolution_check`: `status = resolved` khi và chỉ khi có `resolution`, `resolved_by_id`, `resolved_at`; `handled_externally` phải có `note` không rỗng.
- Module `api/src/payments/reconciliation.ts`:
  - `restoreOrder(tx, { emails, siteUrl }, audit, itemId, staffId)`;
  - `resolveExternally(tx, audit, itemId, staffId, note)`.

  Cả hai khóa đơn `FOR UPDATE` (cùng khóa với `recordPayment` và hủy đơn) rồi đọc lại mục dưới khóa. Mục đã đóng thì 409; id lạ hay không phải uuid thì 404.
- Khôi phục:
  - đơn phải `cancelled` (mọi `cancelReason`), không thì 409;
  - tổng mọi giao dịch của đơn phải bằng đúng `total`, không thì 409 kèm `details { received, total }`;
  - giữ hàng bằng `reserveStock` của ticket 03; thiếu hàng thì 409 `details: { lines: [{ variantId, sku }] }` và rollback.

  Xong: `processing` + `paid`, xóa `cancelReason`/`cancelledAt`/`reservedUntil`, giao hàng giữ `not_prepared` (nên đơn vào hàng chờ soạn và giữ hàng như đơn đã trả). Sự kiện `restored` (actor staff, `data { received, reconciliationItemIds }`), audit `reconciliation.restore` (entity `order`, `before { status, paymentStatus, cancelReason }`, `after { status, paymentStatus, reconciliationItemIds }`).
- **Mục khác của cùng đơn khi khôi phục:** tổng đã nhận khớp tổng đơn nghĩa là mọi khoản của đơn đều được tính vào việc khôi phục, nên mọi mục còn `open` của đơn cùng được đóng `restored` (một lần audit, liệt kê id). Đơn có mục đã đóng `handled_externally` thì không khôi phục được (409), vì khoản đó có thể đã được hoàn tay nên tổng trong hệ thống không còn đúng.
- Email: tách phần xếp email của `recordPayment` thành `queuePaymentReceivedEmail(tx, { emails, siteUrl }, order)` (`api/src/payments/record-payment.ts`, `order.lines` theo `position`); thanh toán thường và khôi phục cùng gọi, cùng nội dung.
- Đã xử lý ngoài hệ thống: body `ResolveReconciliationRequest { note }` (trim, 1–2000 ký tự, thiếu hay rỗng thì 400 field `note`). Đóng mục, không đổi đơn. Sự kiện `reconciliation_resolved` (`data { reconciliationItemId, amount, note }`), audit `reconciliation.resolve` (entity `order`, `before/after { reconciliationItemId, status, note }`).
- `OrderEventKind` thêm `restored`, `reconciliation_resolved`. Audit để entity `order` nên tự hiện ở lịch sử đơn của ticket 07.
- Route `adminReconciliationRoutes(prisma, storage, { emails, siteUrl })` ở `api/src/routes/admin-reconciliation.ts`, mount `/api/admin/reconciliation`. `adminRoutes` nhận thêm tham số thứ tư `ReconciliationDeps { emails, siteUrl }`.
  - `GET /` (`order.view`), query `ReconciliationQuery` (`status`: `open` mặc định, `resolved`, `all`; `PageQuery`), cũ trước. Trả `ReconciliationPage` = `pageOf(ReconciliationListItem)`: các trường của mục, `amount`, `receivedAt`, `reference`, `source`, `order { code, status, paymentStatus, total, received, recipientName }`.
  - `POST /:id/restore`, `POST /:id/resolve` (`payment.reconcile`), qua `audited()`, trả `AdminOrder` 200 (dựng bằng `loadAdminOrder`).
- Shared: `ReconciliationStatus`, `ReconciliationResolution`, `ReconciliationDetail` (`id, reason, status, resolution, note, resolvedBy, resolvedAt`) ở `orders.ts`; `AdminPaymentTransaction.reconciliation` giờ là `ReconciliationDetail`. `ReconciliationQuery`, `ReconciliationListItem`, `ReconciliationPage`, `ResolveReconciliationRequest` ở `shared/src/reconciliation.ts`.
- Web:
  - Menu "Cần đối soát" (`/admin/reconciliation`, icon `HandCoins`, `order.view`) sau "Đơn hàng" trong nhóm "Bán hàng".
  - Trang `/admin/reconciliation`: lọc trạng thái, bảng (`reconciliation-row`) có đơn, lúc tiền về, lý do, số tiền nhận, đơn đã nhận / phải trả, trạng thái đơn, cách xử lý; link tới `/admin/orders/:code#doi-soat`. Thao tác làm ở trang chi tiết đơn.
  - Component `AdminReconciliationPanel` (prop `order`, emit `update` với `AdminOrder`) gắn sau "Giao dịch thanh toán" ở cột trái, chỉ hiện khi đơn có khoản bị gắn cờ (`admin-reconciliation`, `id="doi-soat"`). Nút "Khôi phục đơn" (`reconciliation-restore`, chỉ khi đơn đã hủy, hỏi `confirm`) và ô ghi chú + "Đã xử lý ngoài hệ thống" (`reconciliation-resolve`) chỉ hiện với `payment.reconcile`.
  - Nhãn: `RECONCILIATION_RESOLUTION_LABELS`, sự kiện `restored`, `reconciliation_resolved`, audit `reconciliation.restore`, `reconciliation.resolve`.
- Smoke không đổi (chỉ trang admin SPA). Chưa xem trang bằng trình duyệt (ticket 14). Số mục cần đối soát ở dashboard là ticket 15.
- Test: `api/test/reconciliation.test.ts` (8 test); `admin-orders.test.ts` cập nhật dạng `reconciliation`.
- Cần chủ doanh nghiệp xác nhận:
  - sales và warehouse cũng xem được danh sách cần đối soát (theo spec `order.view`);
  - khôi phục đóng luôn mọi mục còn mở của đơn; đơn đã có mục "xử lý ngoài hệ thống" thì không khôi phục được;
  - khôi phục được cả đơn do khách tự hủy hay nhân viên hủy, không chỉ đơn hết hạn (theo spec).
