# 05: Giao thất bại: giao lại, nhận hàng hoàn về, giao lại từ kho

**What to build:**
- Đơn giao thất bại không còn treo. Nhân viên kho ghi được một lần giao lại với mã vận đơn mới, hoặc ghi nhận hàng hoàn về theo từng dòng (nhập lại tồn, hoặc hỏng/mất).
- Sau khi hàng đã hoàn về:
  - nhân viên bán hàng hủy đơn và đề xuất hoàn, với lý do "giao thất bại";
  - hoặc kho giao lại từ kho, hệ thống giữ hàng lại cho đơn.

**Blocked by:** 02

**Status:** resolved

- [x] Migration:
  - `fulfillment_status` thêm `returned`;
  - `stock_movement_kind` thêm `return`;
  - check `stock_movement_order_check` thành `kind IN ('sale', 'return')` ↔ có `order_id`;
  - `order_handover_check` coi `returned` là chưa bàn giao;
  - `order_line` thêm `returned_quantity`, `written_off_quantity` (mặc định 0, tổng ≤ số lượng).
- [x] **Giao lại** `POST /api/admin/orders/:code/redeliver` (`order.fulfill`): `failed` → `handed_over` với đơn vị vận chuyển, mã vận đơn mới và `handed_over_at` mới. Không đổi tồn. Sự kiện đơn giữ mã cũ. Audit `order.redeliver`.
- [x] **Nhận hàng hoàn về** `POST /api/admin/orders/:code/return-to-stock` (`order.fulfill`):
  - với mỗi dòng: số nhập lại tồn + số hỏng/mất = số lượng, sai thì 400;
  - phần nhập lại tồn đi qua `changeStock` với loại `return` trỏ về đơn; phần hỏng/mất không ghi sổ;
  - xóa đơn vị vận chuyển, mã vận đơn, `handed_over_at` (giữ trong sự kiện đơn);
  - `failed` → `returned`. Audit `order.return_to_stock`.
- [x] **Giao lại từ kho** `POST /api/admin/orders/:code/restock-redeliver` (`order.fulfill`): `returned` → `not_prepared`, giữ hàng lại bằng `reserveStock` cho mọi dòng, thiếu thì 409. Áp cả cho đơn đặt trước. Audit `order.restock_redeliver`.
- [x] Hủy đơn đã nhận tiền (ticket 02) cho phép `returned` và không nhả hàng ở trạng thái này. `failed` vẫn 409.
- [x] Sổ xuất nhập và trang tồn hiện loại biến động mới "Hàng hoàn về", có link về đơn.
- [x] Web admin: `AdminFulfillmentPanel` ở `failed` có "Giao lại" (form đơn vị vận chuyển, mã vận đơn) và "Nhận hàng hoàn về" (form từng dòng); ở `returned` có "Giao lại từ kho". Bỏ ghi chú "chờ M6".
- [x] Test qua HTTP:
  - giao lại đổi mã vận đơn, không đổi tồn, sai cạnh thì 409;
  - nhận hàng hoàn về ghi `return` đúng số, phần hỏng/mất không vào sổ, tổng sai thì 400;
  - giao lại từ kho giữ hàng hoặc 409 khi thiếu;
  - hủy ở `failed` thì 409, ở `returned` thì được và tồn không đổi;
  - thiếu `order.fulfill` thì 403.

Spec: mục "Giao thất bại".

**Quyết định khi triển khai (2026-11-17):**
- Migration `20261117000600_failed_delivery`:
  - thêm `fulfillment_status.returned` và `stock_movement_kind.return`;
  - sửa `stock_movement_order_check` thành `kind IN ('sale', 'return')` ↔ có `order_id`, so theo `::text` vì giá trị enum mới chưa dùng được trong cùng transaction;
  - `order_line` có thêm `returned_quantity`, `written_off_quantity` (≥ 0, tổng ≤ số lượng).
- `order_handover_check` **không phải sửa**, khác với ticket ghi: `returned` vốn không thuộc nhóm đã bàn giao, nên check đã đòi ba trường vận chuyển trống, đúng với việc nhận hàng hoàn về xóa ba trường đó.
- Hai số trên dòng đơn là kết quả của **lần nhận hàng hoàn về gần nhất**. Giao lại từ kho đưa cả hai về 0, để một đơn giao thất bại lần hai vẫn thỏa check tổng ≤ số lượng. Lịch sử đầy đủ nằm ở sự kiện đơn `returned_to_stock` và sổ xuất nhập.
- `api/src/orders/fulfill-order.ts` có thêm ba hàm, đều qua `lockForTransition`:
  - `redeliverOrder` (`failed` → `handed_over`). Sự kiện `redelivered` có `previous` là mã cũ;
  - `returnToStock` (`failed` → `returned`):
    - request theo `variantId`, mọi dòng đơn đúng một lần;
    - tổng sai, dòng lạ hay thiếu dòng thì 400 gắn `lines.i`;
    - phần nhập lại tồn qua `changeStock` loại `return`;
    - xóa đơn vị vận chuyển, mã vận đơn, lúc bàn giao;
  - `restockForRedelivery` (`returned` → `not_prepared`): `reserveStock` cho mọi dòng, thiếu thì 409 kèm `details.skus`.
- Sự kiện đơn mới: `redelivered`, `returned_to_stock`, `restocked_for_redelivery`. Audit: `order.redeliver`, `order.return_to_stock`, `order.restock_redeliver`.
- `cancelPaidOrder` cho hủy ở `returned`; ở `failed` vẫn 409, thông điệp nhắc phải nhận hàng hoàn về trước.
- `OrderLineView` có thêm `returnedQuantity`, `writtenOffQuantity`. Khách không thấy hai số này trên giao diện.
- Web:
  - `AdminFulfillmentPanel`:
    - ở `failed`: form "Giao lại" và form "Nhận hàng hoàn về" (mỗi dòng có ô nhập lại tồn và ô hỏng/mất, mặc định nhập lại cả dòng, nút bị khóa khi tổng sai);
    - ở `returned`: hiện kết quả từng dòng và nút "Giao lại từ kho";
    - bỏ ghi chú "chờ M6";
  - nút "Hủy đơn" đã nhận tiền mở cả ở `returned`;
  - nhãn cho trạng thái giao hàng `returned`, loại biến động "Hàng hoàn về" và các sự kiện mới. Sổ xuất nhập vốn đã có link về đơn qua `orderCode` cho mọi loại biến động;
  - `OrderView` của khách có câu báo hàng đã trả về shop khi đơn ở `returned`.
- Test `api/test/order-failed-delivery.test.ts` (7 test).
- Chưa chạy thử giao diện trên trình duyệt; E2E ở ticket 07.
