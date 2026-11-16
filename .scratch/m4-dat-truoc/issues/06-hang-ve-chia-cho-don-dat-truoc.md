# 06: Hàng về được chia cho đơn đặt trước

**What to build:**
- Khi kho ghi phiếu nhập, hàng của từng biến thể được giữ ngay cho các đơn đặt trước đã cọc đang chờ, theo thứ tự cọc, từng cái một; phần dư mới thành hàng sẵn. Đơn được giữ đủ hàng thì thành "hàng đã về", có hạn trả phần còn lại, và khách nhận email. Kho xem trước được kết quả chia trước khi ghi.

**Blocked by:** 05

**Status:** resolved

- [x] Dòng đơn có `reserved_quantity` (0 ≤ x ≤ quantity). Với đơn `standard`, giá trị này bằng `quantity` khi giữ hàng (migration điền cho đơn cũ đang giữ). Đơn `preorder` có `arrived_at`, `remainder_due_at`
- [x] Ghi phiếu nhập (mọi phiếu, không gắn đợt): trong cùng transaction, qua module kho, sau khi cộng `on_hand` thì chia theo spec mục "Hàng về". Các dòng được sắp theo `deposit_paid_at` rồi mã đơn; mỗi dòng cộng `reserved_quantity` và `reserved` của biến thể. Đơn chờ cọc không được chia
- [x] Dòng vừa được giữ đủ → `arrived_at` = bây giờ, `remainder_due_at` = `arrived_at` + số ngày đã chụp, sự kiện đơn (actor: hệ thống), email "Hàng đã về" (phần còn lại, hạn trả, link trang đơn)
- [x] Điều chỉnh tồn và tồn đầu kỳ không chia hàng. Điều chỉnh xuống dưới `reserved` thì 409, kèm cả mã đơn đặt trước đang giữ
- [x] Xem trước: với các dòng định nhập, trả số sẽ giữ cho đơn đặt trước, số đơn liên quan, số thành hàng sẵn; không ghi gì. Form phiếu nhập ở admin hiện phần này trước khi xác nhận
- [x] Trang đơn (khách và admin) hiện số đã về / số lượng và hạn trả
- [x] Test qua HTTP: A(2) B(3) C(1) nhập 4 → A đủ, B 2/3, C 0, không có hàng sẵn mới; nhập tiếp 2 → B đủ, C đủ; nhập dư → phần dư thành `in_stock`; đơn chờ cọc bị bỏ qua; preview khớp kết quả thật; email một lần cho mỗi đơn đủ hàng; điều chỉnh không chia; 409 điều chỉnh liệt kê đơn đặt trước

Spec: mục "Hàng về", ADR 0013.

**Quyết định khi triển khai (2026-11-16):**
- Migration `20261116000300_preorder_arrivals`:
  - `order_line.reserved_quantity` (mặc định 0, check `0..quantity`). Bước điền: dòng của đơn hàng sẵn đang giữ hàng (chờ thanh toán, hoặc đã trả mà chưa bàn giao) nhận `reserved_quantity = quantity`. Bước điền đã được chạy thử ngày 2026-11-16 trên Postgres tạm dừng ở migration ngay trước (xem cuối ticket).
  - `order.arrived_at` và `remainder_due_at`, với check `order_arrival_check`: cả hai cùng trống, hoặc đơn đặt trước đã cọc có cả hai và hạn sau lúc về.
  Đã đối chiếu với schema trên Postgres tạm: không lệch.
- **`reserved_quantity` luôn là số đang thực sự giữ** cho dòng:
  - đặt mua M3 ghi bằng `quantity` (giữ hàng chạy trước trong cùng transaction);
  - khôi phục đơn hàng sẵn từ đối soát đặt lại bằng `quantity`;
  - phiếu nhập cộng dần cho đơn đặt trước;
  - hủy nhả **đúng số đang giữ** rồi đưa về 0 (thay cho nhánh "bỏ qua đơn đặt trước" của ticket 04, giờ đã gỡ);
  - bàn giao nhả `reserved_quantity` thay cho `quantity` rồi đưa về 0.
  `ordersHoldingVariant` (danh sách mã đơn trong lỗi 409 khi điều chỉnh tồn) chỉ còn đọc `reserved_quantity > 0`, nên có cả đơn đặt trước đã được giữ hàng, còn đơn chờ cọc thì không.
- `api/src/preorders/arrivals.ts`:
  - `planArrivals(db, received, { lock })`: với mỗi biến thể, lấy các dòng của đơn đặt trước `processing` + `deposit_paid` còn thiếu hàng, sắp theo `deposit_paid_at` rồi mã đơn, chia từng cái tới hết hàng về. Khi `lock`, khóa các dòng đó `FOR UPDATE OF l`, sau khi `changeStock` đã khóa biến thể.
  - `applyArrivals(tx, mail, plans, receiptId)`: cộng `reserved` của biến thể và `reserved_quantity` của dòng, ghi sự kiện `stock_allocated` cho mỗi phần chia. Đơn nào mọi dòng đã đủ thì có `arrived_at = now`, `remainder_due_at = now + remainder_days` ngày, sự kiện `arrived` và email "Hàng đã về cho đơn đặt trước #…" (phần còn lại, hạn trả theo giờ Việt Nam, link trang đơn có token mới; bản nháp chờ chủ doanh nghiệp duyệt).
- Phiếu nhập: gọi `planArrivals` + `applyArrivals` ngay sau `changeStock`, trong cùng transaction của `audited()`. Audit `stock.receipt.create` có thêm `preorderAllocations` (SKU, mã đơn, số lượng) và `arrivedOrderCodes` khi có chia hàng. Điều chỉnh tồn và tồn đầu kỳ không đi qua đường này.
- `POST /api/admin/stock/receipts/preview` (`stock.adjust`): kiểm SKU giống ghi phiếu (tách thành `resolveLines`), trả mỗi dòng `forPreorders`, `preorderOrders`, `ordersCompleted`, `toStock`. Không khóa, không ghi gì.
- `OrderPreorder` có thêm `arrivedQuantity`, `quantity`, `arrivedAt`, `remainderDueAt`. `arrivedQuantity` bằng `quantity` khi đã về đủ, để vẫn đúng sau khi bàn giao đưa số đang giữ về 0.
- Web:
  - form phiếu nhập có bước "Xem trước phần chia": lần bấm đầu gọi xem trước và hiện cột "Giữ cho đơn đặt trước"; sửa dòng nào thì phải xem trước lại; bấm lần nữa mới ghi;
  - trang đơn của khách hiện "Đã về x/y" hoặc "Hàng đã về đủ" kèm hạn trả;
  - trang đơn admin có dòng hàng về kèm lúc về đủ và hạn trả;
  - nhãn sự kiện mới.
- Test: `api/test/preorder-arrivals.test.ts` (7 test). Các test bàn giao và hủy của M3 đã phủ việc `reserved_quantity` được ghi và nhả đúng cho đơn hàng sẵn. Toàn bộ bộ test API (46 file, 506 test) và test web (12) qua.

**Kiểm bước điền dữ liệu của migration (2026-11-16, sau review):**
- Postgres 17 tạm, chạy các migration tới `20261116000200_order_deposit_paid_at`. Chèn 9 đơn, mỗi đơn một dòng: hàng sẵn chờ thanh toán, đã trả chưa soạn, đang soạn, đã bàn giao, đã giao, giao thất bại, đã hủy; đặt trước chờ cọc, đã cọc. Khóa ngoại được tắt trong phiên chèn (`session_replication_role = replica`) để khỏi dựng sản phẩm; check constraint vẫn chạy.
- Chạy `20261116000300_preorder_arrivals`: ba đơn đang giữ hàng (chờ thanh toán, đã trả chưa soạn, đang soạn) nhận `reserved_quantity = quantity`; sáu đơn còn lại nhận 0. Đúng với mọi trường hợp; các check constraint mới không lỗi với dữ liệu cũ.
- Sau khi deploy lên DB thật, chạy câu sau để chắc số đang giữ của biến thể khớp với tổng của dòng đơn (kết quả phải là 0):
  `SELECT count(*) FROM product_variant v WHERE v.reserved <> COALESCE((SELECT SUM(l.reserved_quantity) FROM order_line l WHERE l.variant_id = v.id), 0);`
