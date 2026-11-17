# 03: Hủy đơn đặt trước đã cọc, mất cọc, chia lại hàng đã về

**What to build:**
- Nhân viên bán hàng hủy được đơn đặt trước đã cọc, hoặc đã trả đủ mà chưa bàn giao. Số hoàn do nhân viên quyết theo lý do (mất cọc). Riêng "không nhập được hàng" thì luôn hoàn đủ.
- Hàng đã giữ cho đơn bị hủy chuyển cho đơn chờ kế tiếp cùng biến thể theo thứ tự cọc. Không còn đơn chờ thì hàng thành hàng sẵn.
- Suất của đơn trả lại cho đợt.

**Blocked by:** 02

**Status:** resolved

- [x] Hàm hủy của ticket 02 thêm nhánh đơn `preorder`: phần `reserved_quantity > 0` của dòng đơn được chia lại cho đơn đang chờ theo cùng quy tắc với `planArrivals`/`applyArrivals` (ADR 0013), có khóa `FOR UPDATE`. Phần dư được nhả khỏi giữ hàng. Đơn chờ nào về đủ thì thành hàng đã về (hạn trả phần còn lại, sự kiện đơn, email "Hàng đã về").
  - Nếu cần, tách lõi chia hàng của `arrivals.ts` để phiếu nhập và hủy đơn dùng chung. Không chép logic sang chỗ khác.
- [x] Đơn quá hạn trả phần còn lại hủy được với `remainder_overdue`. Không có job tự hủy.
- [x] Hộp thoại hủy ở admin: với đơn đặt trước, hiện tiền cọc đã nhận và nhắc tham chiếu chính sách đặt trước. Chọn "không nhập được hàng" thì khóa ô số hoàn ở mức toàn bộ.
- [x] Email "Đơn đã hủy" có biến thể cho đơn đặt trước: nêu số không hoàn khi có mất cọc.
- [x] Test qua HTTP:
  - hủy đơn `deposit_paid` chưa về: không đổi tồn; suất đợt trống lại; lượt mã giảm giá trống lại;
  - hủy đơn đã về: hàng chuyển cho đơn chờ kế tiếp theo thứ tự cọc; đơn đó có hạn trả và email; không còn đơn chờ thì thành hàng sẵn (còn hàng);
  - đơn giữ một phần cũng chia đúng;
  - mất cọc: số hoàn < cọc kèm ghi chú thì được, có hoàn tiền đúng số;
  - `supply_failed` với số khác toàn bộ thì 400;
  - đơn đặt trước đã trả đủ chưa bàn giao hủy được, số có thể hoàn gồm cả hai giao dịch.

Spec: mục "Hủy đơn đã nhận tiền" (nhả hàng đặt trước), ADR 0013.

**Quyết định khi triển khai (2026-11-17):**
- `cancelPaidOrder` bỏ chặn 409 với đơn đặt trước. Trước khi nhả hàng, hàm nhớ số đang giữ của các dòng.
- Thứ tự làm, tất cả trong cùng transaction:
  1. nhả hàng;
  2. đặt đơn `cancelled`;
  3. `planArrivals(..., { lock: true })` chia số vừa nhả. Đơn đã `cancelled` nên không tự nhận lại hàng của mình;
  4. `applyArrivals` giữ hàng cho các đơn chờ, ghi `stock_allocated`, và đưa đơn về đủ thành hàng đã về (hạn trả, email "Hàng đã về");
  5. phần dư thành hàng sẵn.
- Lõi chia hàng không bị chép sang chỗ khác:
  - `applyArrivals` nhận `source: { receiptId } | { fromOrderCode }` thay cho `receiptId`, và ghi `source` vào sự kiện `stock_allocated`/`arrived`;
  - route phiếu nhập truyền `{ receiptId }`.
- Audit `order.cancel_paid` có thêm `reallocated` (mã đơn, biến thể, số lượng) và `arrivedOrderCodes` khi có chia lại.
- Suất của đợt tự trống, vì suất tính trên đơn chưa hủy (`usedAllocations`).
- Sau khi commit, route hủy mọi link thanh toán của đơn (`cancelPaymentLinks`), để khách không trả phần còn lại cho đơn đã hủy. Tiền về sau đó thành cần đối soát như M3.
- Email "Đơn đã hủy":
  - đơn đặt trước nhắc "chính sách đặt trước";
  - hoàn một phần thì có thêm dòng "Phần không hoàn: …";
  - hoàn 0 thì ghi "không được hoàn tiền theo chính sách đặt trước…".
- Web:
  - nút hủy đơn đã nhận tiền mở cho cả đơn đặt trước;
  - `AdminCancelPaidForm` hiện tiền cọc và nhắc chính sách đặt trước;
  - `OrderView` và trang kết quả thanh toán (`don-hang/[code].vue`) chỉ coi đơn là chờ phần còn lại khi đơn còn `processing`. Đơn đã hủy vẫn giữ trạng thái thanh toán `deposit_paid` (ADR 0014) nên trước đây sẽ hiện nhầm nút trả.
- Test `api/test/preorder-cancel-paid.test.ts` (8 test). "Lượt mã giảm giá trống lại" không có test riêng cho đơn đặt trước: đơn đặt trước và đơn hàng sẵn cùng cơ chế (lượt tính trên đơn chưa hủy, M5), và cơ chế này đã được test ở `order-cancel-paid.test.ts`.
- Chưa chạy thử giao diện trên trình duyệt; E2E ở ticket 07.
