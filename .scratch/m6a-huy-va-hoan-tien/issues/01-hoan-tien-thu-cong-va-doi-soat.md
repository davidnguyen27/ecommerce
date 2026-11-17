# 01: Hoàn tiền thủ công, giải quyết đối soát bằng hoàn tiền

**What to build:**
- Mô hình hoàn tiền dùng cho cả mốc (ADR 0014), qua lối vào đầu tiên: kế toán giải quyết một mục cần đối soát bằng cách hoàn số tiền đó, rồi ghi lại lần chuyển khoản thủ công.
- Chi tiết đơn ở trang quản trị hiện các số đã nhận, đã hoàn, đang hoàn và danh sách các khoản hoàn.
- Khách nhận email khi khoản hoàn đã xong.

**Blocked by:** —

**Status:** resolved

- [x] Migration bảng `refund` theo spec:
  - cột: số tiền, `origin`, `status`, `method`, giao dịch gốc, mã ngân hàng, ngày chuyển, ghi chú, payload cổng, người tạo/thực hiện/chốt, thời điểm;
  - check DB: `method` ↔ không `pending`; `payment_transaction_id` ↔ `vnpay`; `completed_at` ↔ `succeeded`/`failed`;
  - `reconciliation_resolution` thêm `refunded`.
- [x] Quyền mới `payment.refund` (owner, accountant) và `order.cancel_paid` (owner, sales) trong registry quyền. `order.cancel_paid` khai ở đây để menu và schema shared đủ một lần; ticket 02 mới dùng tới.
- [x] Hàm tính **số có thể hoàn**: tổng giao dịch của đơn − tổng hoàn tiền không `failed`. Kiểm dưới khóa đơn `FOR UPDATE` ở mọi chỗ tạo hoàn tiền.
- [x] `POST /api/admin/reconciliation/:id/refund` (`payment.reconcile`): tạo hoàn tiền `pending` (`origin = reconciliation`) bằng số tiền của mục, đóng mục với `refunded`. Mục đã đóng thì 409; vượt số có thể hoàn thì 409. Audit `reconciliation.refund`.
- [x] `POST /api/admin/refunds/:id/manual` (`payment.refund`): `pending` → `succeeded`, kèm `bankReference`, `transferredOn`, ghi chú tùy chọn. Audit `refund.execute_manual`.
- [x] `POST /api/admin/refunds/:id/settle` (`payment.refund`): `processing` → `succeeded` hoặc `failed`, ghi chú bắt buộc. Audit `refund.settle`.
- [x] `POST /api/admin/refunds/:id/retry` (`payment.refund`): từ `failed`, tạo hoàn tiền `pending` mới (`origin = retry`), số tiền ≤ số của khoản thất bại và ≤ số có thể hoàn. Audit `refund.retry`.
- [x] Email "Đã hoàn tiền" (mã đơn, số tiền, ngày), gửi khi một hoàn tiền chuyển sang `succeeded`. Nội dung tạm.
- [x] Chi tiết đơn ở trang quản trị trả `received`, `refunded`, `refunding` và danh sách hoàn tiền. Danh sách đơn có bộ lọc `refund=open`.
- [x] Web admin:
  - nút "Hoàn tiền" ở trang đối soát;
  - khối "Hoàn tiền" ở chi tiết đơn, có nút "Ghi chuyển khoản", "Đánh dấu đã hoàn/thất bại", "Tạo lại" theo quyền;
  - bộ lọc "Hoàn tiền chưa xong" ở danh sách đơn.
- [x] Test qua HTTP:
  - giải quyết đối soát bằng hoàn tiền: đúng số tiền, mục đóng, mục đã đóng thì 409;
  - thủ công `pending` → `succeeded`, có email;
  - chốt `processing` (dựng trạng thái bằng prisma);
  - tạo lại từ `failed`, vượt giới hạn thì 400/409;
  - hai yêu cầu song song không làm tổng vượt đã nhận;
  - sales và warehouse bị 403;
  - audit có trước và sau.

Spec: mục "Hoàn tiền (ADR 0014)", "Đối soát", "Quyền", "API quản trị", "Email", "Web".

**Quyết định khi triển khai (2026-11-17):**
- Migration `20261117000400_refunds`:
  - thêm enum `refund_origin`, `refund_status`, `refund_method`, bảng `refund`, và giá trị `reconciliation_resolution.refunded`;
  - check `refund_origin_check`: `reconciliation` ↔ có mục đối soát; `retry` ↔ có khoản gốc;
  - check `refund_status_check`:
    - `pending` ↔ chưa có `method`, người thực hiện, lúc thực hiện;
    - `succeeded`/`failed` ↔ có `completed_at`;
    - `vnpay` ↔ có giao dịch gốc;
    - `manual` ↔ có mã ngân hàng và ngày chuyển, và chỉ ở `succeeded`;
    - người chốt chỉ có ở `succeeded`/`failed`;
  - `retry_of_id` unique, nên mỗi khoản thất bại chỉ tạo lại được một lần;
  - check của mục đối soát so `resolution::text` (giá trị enum mới chưa dùng được trong cùng transaction): `refunded` cũng bắt buộc có người đóng.
- `api/src/payments/refunds.ts`:
  - `refundTotals`: đã nhận, đã hoàn, đang hoàn, còn hoàn được. Truy vấn chạy tuần tự vì trong transaction chỉ có một kết nối;
  - `createRefund`: gọi khi đơn đã bị khóa; vượt số còn hoàn được thì 409 kèm `details.refundable`;
  - `executeManualRefund`, `settleRefund`, `retryRefund`: khóa đơn rồi đọc lại khoản dưới khóa; id lạ thì 404, sai trạng thái thì 409.

  Ticket 02 và 06 dùng lại `createRefund` và `lockOrderForRefund`.
- Ghi chú của khoản hoàn là một trường. Ghi chú lúc thực hiện hay lúc chốt được nối thêm dòng mới, không ghi đè.
- Mức số tiền:
  - vượt số còn hoàn được, hoặc tạo lại vượt khoản thất bại: **409** (phụ thuộc trạng thái);
  - số tiền ≤ 0 khi tạo lại: 400 (schema).

  Spec ghi "400" cho số hoàn vượt mức lúc hủy đơn. Ticket 02 sẽ kiểm ở tầng route trước khi gọi `createRefund` nếu muốn giữ 400.
- Khôi phục đơn từ đối soát bị chặn (409) khi đơn có khoản hoàn không thất bại.
- Sự kiện đơn mới: `refund_created`, `refund_succeeded`, `refund_failed`. Giải quyết đối soát bằng hoàn tiền ghi `reconciliation_resolved` kèm `resolution: refunded`.
- Audit action: `reconciliation.refund`, `refund.execute_manual`, `refund.settle`, `refund.retry`.
- `AdminOrder` có thêm `received`, `refunded`, `refunding`, `refundable` và `refunds` (`AdminRefund`: người tạo, người thực hiện, người chốt, `retriedById`). `PublicOrder` chưa đổi; ticket 02 làm phần khách thấy.
- Email "Đã hoàn tiền":
  - nội dung: số tiền, ngày (ngày chuyển với thủ công, lúc chốt với cổng), link tra cứu có token mới;
  - không có mã ngân hàng;
  - là bản nháp chờ chủ doanh nghiệp duyệt.
- Quyền:
  - sales có thêm `order.cancel_paid`; chưa endpoint nào dùng tới, ticket 02 mới dùng;
  - accountant có thêm `payment.refund`;
  - `admin-orders.test.ts` cập nhật danh sách quyền `order.*` của sales.
- Web:
  - `AdminRefundPanel` ở cột trái chi tiết đơn, dưới khối đối soát; chỉ hiện khi đơn có khoản hoàn. Ghi chuyển khoản mặc định ngày hôm nay theo giờ Việt Nam;
  - `AdminReconciliationPanel` có nút "Hoàn tiền";
  - danh sách đơn có ô "Hoàn tiền chưa xong", hoặc mở thẳng bằng `?refund=open`.
- Test `api/test/refunds.test.ts` (9 test): trạng thái `processing` được dựng bằng prisma, vì ticket 06 mới gọi cổng.
- Chưa chạy thử giao diện trên trình duyệt; E2E ở ticket 07.
