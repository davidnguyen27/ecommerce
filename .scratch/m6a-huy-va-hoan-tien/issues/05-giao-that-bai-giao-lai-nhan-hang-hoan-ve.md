# 05: Giao thất bại: giao lại, nhận hàng hoàn về, giao lại từ kho

**What to build:**
- Đơn giao thất bại không còn treo. Nhân viên kho ghi được một lần giao lại với mã vận đơn mới, hoặc ghi nhận hàng hoàn về theo từng dòng (nhập lại tồn, hoặc hỏng/mất).
- Sau khi hàng đã hoàn về:
  - nhân viên bán hàng hủy đơn và đề xuất hoàn, với lý do "giao thất bại";
  - hoặc kho giao lại từ kho, hệ thống giữ hàng lại cho đơn.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Migration:
  - `fulfillment_status` thêm `returned`;
  - `stock_movement_kind` thêm `return`;
  - check `stock_movement_order_check` thành `kind IN ('sale', 'return')` ↔ có `order_id`;
  - `order_handover_check` coi `returned` là chưa bàn giao;
  - `order_line` thêm `returned_quantity`, `written_off_quantity` (mặc định 0, tổng ≤ số lượng).
- [ ] **Giao lại** `POST /api/admin/orders/:code/redeliver` (`order.fulfill`): `failed` → `handed_over` với đơn vị vận chuyển, mã vận đơn mới và `handed_over_at` mới. Không đổi tồn. Sự kiện đơn giữ mã cũ. Audit `order.redeliver`.
- [ ] **Nhận hàng hoàn về** `POST /api/admin/orders/:code/return-to-stock` (`order.fulfill`):
  - với mỗi dòng: số nhập lại tồn + số hỏng/mất = số lượng, sai thì 400;
  - phần nhập lại tồn đi qua `changeStock` với loại `return` trỏ về đơn; phần hỏng/mất không ghi sổ;
  - xóa đơn vị vận chuyển, mã vận đơn, `handed_over_at` (giữ trong sự kiện đơn);
  - `failed` → `returned`. Audit `order.return_to_stock`.
- [ ] **Giao lại từ kho** `POST /api/admin/orders/:code/restock-redeliver` (`order.fulfill`): `returned` → `not_prepared`, giữ hàng lại bằng `reserveStock` cho mọi dòng, thiếu thì 409. Áp cả cho đơn đặt trước. Audit `order.restock_redeliver`.
- [ ] Hủy đơn đã nhận tiền (ticket 02) cho phép `returned` và không nhả hàng ở trạng thái này. `failed` vẫn 409.
- [ ] Sổ xuất nhập và trang tồn hiện loại biến động mới "Hàng hoàn về", có link về đơn.
- [ ] Web admin: `AdminFulfillmentPanel` ở `failed` có "Giao lại" (form đơn vị vận chuyển, mã vận đơn) và "Nhận hàng hoàn về" (form từng dòng); ở `returned` có "Giao lại từ kho". Bỏ ghi chú "chờ M6".
- [ ] Test qua HTTP:
  - giao lại đổi mã vận đơn, không đổi tồn, sai cạnh thì 409;
  - nhận hàng hoàn về ghi `return` đúng số, phần hỏng/mất không vào sổ, tổng sai thì 400;
  - giao lại từ kho giữ hàng hoặc 409 khi thiếu;
  - hủy ở `failed` thì 409, ở `returned` thì được và tồn không đổi;
  - thiếu `order.fulfill` thì 403.

Spec: mục "Giao thất bại".
